//! Secure Cohere gateway and local AI attachment store.
//!
//! The WebView never receives a saved API key and never chooses an outbound
//! URL.  Rust owns the credential lifecycle, validates a deliberately narrow
//! provider request vocabulary, talks only to Cohere over HTTPS, and forwards
//! the documented V2 SSE events over a typed Tauri channel.  Tool execution
//! remains application-owned: the model may emit a plan and calls, and a later
//! request may carry the corresponding tool results.

use crate::library::LibraryPaths;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use keyring::v1::{Entry as KeyringEntry, Error as KeyringError};
use quick_xml::{events::Event as XmlEvent, Reader as XmlReader};
use reqwest::{header, Client, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map as JsonMap, Value as JsonValue};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet, VecDeque};
use std::future::Future;
use std::io::{Cursor, Read, Write};
use std::num::NonZeroU64;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::ipc::Channel;
use tokio::sync::Notify;
use zeroize::Zeroizing;

const COHERE_ORIGIN: &str = "https://api.cohere.com";
const CLIENT_NAME: &str = "Alcove";
const KEYRING_SERVICE: &str = "com.alcove.app.ai";
const KEYRING_ACCOUNT: &str = "cohere-api-key";

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const READ_TIMEOUT: Duration = Duration::from_secs(60);
const CHAT_DEADLINE: Duration = Duration::from_secs(10 * 60);
const JSON_DEADLINE: Duration = Duration::from_secs(90);
const MAX_ATTEMPTS: u8 = 3;
const MAX_RETRY_DELAY: Duration = Duration::from_secs(60);

const MAX_MESSAGES: usize = 128;
const MAX_MESSAGE_TEXT_BYTES: usize = 2 * 1024 * 1024;
const MAX_TOOLS: usize = 48;
const MAX_TOOL_SCHEMA_BYTES: usize = 256 * 1024;
const MAX_DOCUMENTS: usize = 128;
const MAX_DOCUMENT_BYTES: usize = 2 * 1024 * 1024;
const MAX_JSON_DEPTH: usize = 16;
const MAX_JSON_NODES: usize = 16_384;
const MAX_IMAGES: usize = 20;
const MAX_IMAGE_BYTES: usize = 20 * 1024 * 1024;
const MAX_REQUEST_BYTES: usize = 32 * 1024 * 1024;
const MAX_JSON_RESPONSE_BYTES: usize = 16 * 1024 * 1024;
const MAX_STREAM_BYTES: usize = 16 * 1024 * 1024;
const MAX_SSE_FRAME_BYTES: usize = 512 * 1024;
// Stop may cross the WebView -> native boundary before the matching provider
// command has registered. Retain a bounded one-shot cancellation intent so a
// later registration cannot start the request after the reader pressed Stop.
const MAX_PENDING_RUN_CANCELLATIONS: usize = 1_024;

const MAX_ATTACHMENT_BYTES: usize = 32 * 1024 * 1024;
const MAX_PDF_PAGES: usize = 500;
const MAX_PDF_PAGE_TEXT_BYTES: usize = 256 * 1024;
const MAX_PDF_TOTAL_TEXT_BYTES: usize = 8 * 1024 * 1024;
const MAX_PDF_VISUALS_PER_PAGE: usize = 4;
const MAX_TEXT_ATTACHMENT_BYTES: usize = 8 * 1024 * 1024;
const MAX_EXTRACTED_DOCUMENT_BYTES: usize = 12 * 1024 * 1024;
const MAX_OFFICE_ARCHIVE_ENTRIES: usize = 2_048;
const MAX_OFFICE_ARCHIVE_EXPANDED_BYTES: u64 = 64 * 1024 * 1024;
const MAX_OFFICE_ENTRY_BYTES: u64 = 16 * 1024 * 1024;

static ATTACHMENT_TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);
static CREDENTIAL_TEST_RUN_COUNTER: AtomicU64 = AtomicU64::new(0);

// ---------------------------------------------------------------------------
// Public errors and state
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AiErrorCode {
    InvalidRequest,
    NotConfigured,
    Authentication,
    PermissionDenied,
    RateLimited,
    ProviderUnavailable,
    Timeout,
    Network,
    ProviderProtocol,
    Cancelled,
    DuplicateRun,
    CredentialStoreUnavailable,
    AttachmentNotFound,
    AttachmentInvalid,
    PdfInvalid,
    Internal,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiError {
    pub code: AiErrorCode,
    pub message: String,
    pub retryable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<u16>,
}

impl AiError {
    fn new(code: AiErrorCode, message: impl Into<String>, retryable: bool) -> Self {
        Self {
            code,
            message: message.into(),
            retryable,
            status: None,
        }
    }

    fn with_status(mut self, status: StatusCode) -> Self {
        self.status = Some(status.as_u16());
        self
    }

    fn invalid(message: impl Into<String>) -> Self {
        Self::new(AiErrorCode::InvalidRequest, message, false)
    }

    fn cancelled() -> Self {
        Self::new(AiErrorCode::Cancelled, "AI run was cancelled", false)
    }

    fn internal() -> Self {
        Self::new(
            AiErrorCode::Internal,
            "The AI service could not complete that operation",
            false,
        )
    }
}

#[derive(Clone)]
struct SecretString(Zeroizing<String>);

impl SecretString {
    fn new(value: String) -> Self {
        Self(Zeroizing::new(value))
    }

    fn expose(&self) -> &str {
        self.0.as_str()
    }
}

#[derive(Clone)]
struct RunControl {
    cancelled: Arc<AtomicBool>,
    notify: Arc<Notify>,
}

#[derive(Default)]
struct RunRegistry {
    active: HashMap<String, RunControl>,
    cancelled_before_registration: HashSet<String>,
    cancellation_order: VecDeque<String>,
}

impl RunRegistry {
    fn remember_cancellation(&mut self, run_id: &str) {
        if self
            .cancelled_before_registration
            .insert(run_id.to_string())
        {
            self.cancellation_order.push_back(run_id.to_string());
        }
        while self.cancellation_order.len() > MAX_PENDING_RUN_CANCELLATIONS {
            if let Some(expired) = self.cancellation_order.pop_front() {
                self.cancelled_before_registration.remove(&expired);
            }
        }
    }

    fn consume_cancellation(&mut self, run_id: &str) -> bool {
        self.cancelled_before_registration.remove(run_id)
    }
}

impl RunControl {
    fn new() -> Self {
        Self {
            cancelled: Arc::new(AtomicBool::new(false)),
            notify: Arc::new(Notify::new()),
        }
    }

    fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
        self.notify.notify_waiters();
    }

    fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }

    async fn wait<F: Future>(&self, future: F) -> Result<F::Output, AiError> {
        let notified = self.notify.notified();
        tokio::pin!(notified);
        if self.is_cancelled() {
            return Err(AiError::cancelled());
        }
        tokio::select! {
            biased;
            _ = &mut notified => Err(AiError::cancelled()),
            value = future => Ok(value),
        }
    }
}

#[derive(Clone)]
pub struct AiState {
    client: Client,
    session_key: Arc<Mutex<Option<SecretString>>>,
    credential_lock: Arc<Mutex<()>>,
    runs: Arc<Mutex<RunRegistry>>,
}

impl AiState {
    pub fn new() -> Result<Self, String> {
        let client = Client::builder()
            .https_only(true)
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(CONNECT_TIMEOUT)
            .read_timeout(READ_TIMEOUT)
            .user_agent(format!("{CLIENT_NAME}/{}", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|_| "could not initialize the AI HTTP client".to_string())?;
        Ok(Self {
            client,
            session_key: Arc::new(Mutex::new(None)),
            credential_lock: Arc::new(Mutex::new(())),
            runs: Arc::new(Mutex::new(RunRegistry::default())),
        })
    }

    fn register_run(&self, run_id: &str) -> Result<(RunControl, ActiveRun), AiError> {
        validate_run_id(run_id)?;
        let mut runs = lock(&self.runs)?;
        if runs.active.contains_key(run_id) {
            return Err(AiError::new(
                AiErrorCode::DuplicateRun,
                "An AI run with that id is already active",
                false,
            ));
        }
        if runs.consume_cancellation(run_id) {
            return Err(AiError::cancelled());
        }
        let control = RunControl::new();
        runs.active.insert(run_id.to_string(), control.clone());
        Ok((
            control,
            ActiveRun {
                run_id: run_id.to_string(),
                runs: self.runs.clone(),
            },
        ))
    }

    /// Atomically acquire the current credential and publish the run under the
    /// same credential-lifecycle lock used by deletion. Therefore revocation
    /// either happens first (and no key can be cloned) or sees this registered
    /// control and cancels it; there is no clone-then-register gap.
    fn register_authenticated_run(
        &self,
        run_id: &str,
    ) -> Result<(SecretString, RunControl, ActiveRun), AiError> {
        let _guard = lock(&self.credential_lock)?;
        let key = effective_key_unlocked(self)?;
        let (control, active) = self.register_run(run_id)?;
        Ok((key, control, active))
    }

    /// Credential checks are provider requests too. Register them beneath the
    /// credential lifecycle lock so deleting a saved key cannot race between
    /// cloning that key and publishing the RunControl that revocation cancels.
    fn register_credential_test_run(
        &self,
        candidate: Option<String>,
    ) -> Result<(SecretString, RunControl, ActiveRun), AiError> {
        let candidate = candidate.map(normalize_api_key).transpose()?;
        let _guard = lock(&self.credential_lock)?;
        let key = match candidate {
            Some(key) => key,
            None => effective_key_unlocked(self)?,
        };
        let sequence = CREDENTIAL_TEST_RUN_COUNTER.fetch_add(1, Ordering::Relaxed);
        let run_id = format!("credential-test-{sequence}");
        let (control, active) = self.register_run(&run_id)?;
        Ok((key, control, active))
    }

    fn cancel_all_runs(&self) -> Result<usize, AiError> {
        let controls = lock(&self.runs)?
            .active
            .values()
            .cloned()
            .collect::<Vec<_>>();
        for control in &controls {
            control.cancel();
        }
        Ok(controls.len())
    }

    fn cancel_run(&self, run_id: &str) -> Result<(), AiError> {
        let mut runs = lock(&self.runs)?;
        if let Some(control) = runs.active.get(run_id).cloned() {
            control.cancel();
        } else {
            runs.remember_cancellation(run_id);
        }
        Ok(())
    }

    /// Caller must hold `credential_lock`, matching credential-test and
    /// authenticated run registration.
    fn revoke_active_runs_and_session_key_unlocked(&self) -> Result<usize, AiError> {
        let cancelled = self.cancel_all_runs()?;
        *lock(&self.session_key)? = None;
        Ok(cancelled)
    }
}

struct ActiveRun {
    run_id: String,
    runs: Arc<Mutex<RunRegistry>>,
}

impl Drop for ActiveRun {
    fn drop(&mut self) {
        if let Ok(mut runs) = self.runs.lock() {
            runs.active.remove(&self.run_id);
        }
    }
}

fn lock<T>(mutex: &Mutex<T>) -> Result<MutexGuard<'_, T>, AiError> {
    mutex.lock().map_err(|_| AiError::internal())
}

// ---------------------------------------------------------------------------
// Credential lifecycle
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AiCredentialSource {
    Session,
    SecureStore,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiCredentialStatus {
    pub configured: bool,
    pub source: Option<AiCredentialSource>,
    pub secure_store_available: bool,
    pub persistent: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiCredentialSaveRequest {
    api_key: String,
    persistence: AiCredentialPersistence,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AiCredentialPersistence {
    Session,
    Secure,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AiCredentialTestRequest {
    api_key: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiCredentialTestResult {
    pub valid: bool,
}

enum SecureRead {
    Present(SecretString),
    Missing,
    Unavailable,
}

fn keyring_entry() -> Result<KeyringEntry, KeyringError> {
    KeyringEntry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
}

fn secure_store_available() -> bool {
    KeyringEntry::store_status().is_ok()
}

fn read_secure_key_unlocked() -> Result<SecureRead, AiError> {
    let entry = match keyring_entry() {
        Ok(entry) => entry,
        Err(_) => return Ok(SecureRead::Unavailable),
    };
    match entry.get_password() {
        Ok(key) => Ok(SecureRead::Present(SecretString::new(key))),
        Err(KeyringError::NoEntry) => Ok(SecureRead::Missing),
        Err(_) => Ok(SecureRead::Unavailable),
    }
}

fn read_secure_key(state: &AiState) -> Result<SecureRead, AiError> {
    let _guard = lock(&state.credential_lock)?;
    read_secure_key_unlocked()
}

fn effective_key_unlocked(state: &AiState) -> Result<SecretString, AiError> {
    if let Some(key) = lock(&state.session_key)?.as_ref() {
        return Ok(key.clone());
    }
    match read_secure_key_unlocked()? {
        SecureRead::Present(key) => Ok(key),
        SecureRead::Missing | SecureRead::Unavailable => Err(AiError::new(
            AiErrorCode::NotConfigured,
            "Add a Cohere API key in Integrations before using the AI agent",
            false,
        )),
    }
}

fn credential_status_inner(state: &AiState) -> Result<AiCredentialStatus, AiError> {
    if lock(&state.session_key)?.is_some() {
        return Ok(AiCredentialStatus {
            configured: true,
            source: Some(AiCredentialSource::Session),
            secure_store_available: secure_store_available(),
            persistent: false,
        });
    }
    Ok(match read_secure_key(state)? {
        SecureRead::Present(_) => AiCredentialStatus {
            configured: true,
            source: Some(AiCredentialSource::SecureStore),
            secure_store_available: true,
            persistent: true,
        },
        SecureRead::Missing => AiCredentialStatus {
            configured: false,
            source: None,
            secure_store_available: true,
            persistent: false,
        },
        SecureRead::Unavailable => AiCredentialStatus {
            configured: false,
            source: None,
            secure_store_available: false,
            persistent: false,
        },
    })
}

fn normalize_api_key(raw: String) -> Result<SecretString, AiError> {
    let raw = Zeroizing::new(raw);
    let trimmed = raw.trim();
    if !(16..=512).contains(&trimmed.len())
        || !trimmed.is_ascii()
        || trimmed
            .bytes()
            .any(|byte| byte.is_ascii_control() || byte.is_ascii_whitespace())
    {
        return Err(AiError::invalid("That Cohere API key is not valid"));
    }
    Ok(SecretString::new(trimmed.to_string()))
}

#[tauri::command]
pub async fn ai_credential_status(
    state: tauri::State<'_, AiState>,
) -> Result<AiCredentialStatus, AiError> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || credential_status_inner(&state))
        .await
        .map_err(|_| AiError::internal())?
}

#[tauri::command]
pub async fn ai_credential_save(
    state: tauri::State<'_, AiState>,
    request: AiCredentialSaveRequest,
) -> Result<AiCredentialStatus, AiError> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let key = normalize_api_key(request.api_key)?;
        // Serialize save against deletion so a revocation that starts after a
        // save always clears it, while an explicitly later save can configure
        // a new credential.
        let _guard = lock(&state.credential_lock)?;
        match request.persistence {
            AiCredentialPersistence::Session => {
                *lock(&state.session_key)? = Some(key);
                credential_status_inner(&state)
            }
            AiCredentialPersistence::Secure => {
                let saved = keyring_entry()
                    .and_then(|entry| entry.set_password(key.expose()))
                    .is_ok();
                if saved {
                    *lock(&state.session_key)? = None;
                    Ok(AiCredentialStatus {
                        configured: true,
                        source: Some(AiCredentialSource::SecureStore),
                        secure_store_available: true,
                        persistent: true,
                    })
                } else {
                    // Native stores can be absent or locked (notably Secret
                    // Service in a headless Linux session).  Never downgrade
                    // to a plaintext file: retain the key for this process.
                    *lock(&state.session_key)? = Some(key);
                    Ok(AiCredentialStatus {
                        configured: true,
                        source: Some(AiCredentialSource::Session),
                        secure_store_available: false,
                        persistent: false,
                    })
                }
            }
        }
    })
    .await
    .map_err(|_| AiError::internal())?
}

#[tauri::command]
pub async fn ai_credential_delete(
    state: tauri::State<'_, AiState>,
) -> Result<AiCredentialStatus, AiError> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        // Hold the same lifecycle lock as authenticated run registration. Any
        // request that already cloned this credential is necessarily present
        // in `runs` before revocation proceeds and is cancelled here.
        let _guard = lock(&state.credential_lock)?;
        state.revoke_active_runs_and_session_key_unlocked()?;
        let deleted = match keyring_entry().and_then(|entry| entry.delete_credential()) {
            Ok(()) | Err(KeyringError::NoEntry) => true,
            Err(_) => false,
        };
        if !deleted {
            return Err(AiError::new(
                AiErrorCode::CredentialStoreUnavailable,
                "The secure credential store is unavailable; the session key was cleared",
                true,
            ));
        }
        Ok(AiCredentialStatus {
            configured: false,
            source: None,
            secure_store_available: true,
            persistent: false,
        })
    })
    .await
    .map_err(|_| AiError::internal())?
}

// ---------------------------------------------------------------------------
// Typed Cohere request vocabulary
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, Deserialize)]
pub enum AiChatModel {
    #[serde(rename = "command-a-plus-05-2026")]
    CommandAPlus052026,
}

impl AiChatModel {
    fn as_str(self) -> &'static str {
        match self {
            Self::CommandAPlus052026 => "command-a-plus-05-2026",
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatRequest {
    run_id: String,
    model: AiChatModel,
    messages: Vec<AiChatMessage>,
    #[serde(default)]
    tools: Vec<AiToolDefinition>,
    #[serde(default)]
    documents: Vec<AiChatDocument>,
    citation_mode: Option<AiCitationMode>,
    response_format: Option<AiResponseFormat>,
    safety_mode: Option<AiSafetyMode>,
    max_tokens: Option<u32>,
    #[serde(default)]
    stop_sequences: Vec<String>,
    temperature: Option<f64>,
    seed: Option<u64>,
    frequency_penalty: Option<f64>,
    presence_penalty: Option<f64>,
    k: Option<u16>,
    p: Option<f64>,
    tool_choice: Option<AiToolChoice>,
    thinking: Option<AiThinking>,
    priority: Option<u16>,
    strict_tools: Option<bool>,
}

#[derive(Deserialize)]
#[serde(tag = "role", rename_all = "lowercase")]
pub enum AiChatMessage {
    User {
        content: AiUserContent,
    },
    System {
        content: String,
    },
    Assistant {
        content: Option<String>,
        #[serde(default, rename = "toolPlan")]
        tool_plan: Option<String>,
        #[serde(default, rename = "toolCalls")]
        tool_calls: Vec<AiToolCall>,
    },
    Tool {
        #[serde(rename = "toolCallId")]
        tool_call_id: String,
        content: AiToolContent,
    },
}

#[derive(Deserialize)]
#[serde(untagged)]
pub enum AiUserContent {
    Text(String),
    Blocks(Vec<AiUserContentBlock>),
}

#[derive(Deserialize)]
#[serde(tag = "type")]
pub enum AiUserContentBlock {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "image_url")]
    ImageUrl {
        #[serde(rename = "imageUrl")]
        image_url: AiImageUrl,
    },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiImageUrl {
    url: String,
    detail: Option<AiImageDetail>,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AiImageDetail {
    Low,
    High,
    Auto,
}

impl AiImageDetail {
    fn as_str(self) -> &'static str {
        match self {
            Self::Low => "low",
            Self::High => "high",
            Self::Auto => "auto",
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiToolCall {
    id: String,
    #[serde(rename = "type")]
    kind: AiFunctionKind,
    function: AiToolCallFunction,
}

#[derive(Debug, Clone, Copy, Deserialize)]
pub enum AiFunctionKind {
    #[serde(rename = "function")]
    Function,
}

#[derive(Deserialize)]
pub struct AiToolCallFunction {
    name: String,
    arguments: String,
}

#[derive(Deserialize)]
#[serde(untagged)]
pub enum AiToolContent {
    Text(String),
    Blocks(Vec<AiToolContentBlock>),
}

#[derive(Deserialize)]
#[serde(tag = "type")]
pub enum AiToolContentBlock {
    #[serde(rename = "document")]
    Document { document: AiToolDocument },
    #[serde(rename = "text")]
    Text { text: String },
}

#[derive(Deserialize)]
pub struct AiToolDocument {
    id: Option<String>,
    data: JsonValue,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiToolDefinition {
    name: String,
    description: Option<String>,
    parameters: JsonValue,
}

#[derive(Deserialize)]
pub struct AiChatDocument {
    id: Option<String>,
    data: JsonMap<String, JsonValue>,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AiCitationMode {
    Enabled,
    Disabled,
    Fast,
    Accurate,
}

impl AiCitationMode {
    fn provider_str(self) -> &'static str {
        match self {
            Self::Enabled => "ENABLED",
            Self::Disabled => "DISABLED",
            Self::Fast => "FAST",
            Self::Accurate => "ACCURATE",
        }
    }
}

#[derive(Deserialize)]
#[serde(tag = "type")]
pub enum AiResponseFormat {
    #[serde(rename = "text")]
    Text,
    #[serde(rename = "json_object")]
    JsonObject {
        #[serde(default, rename = "jsonSchema")]
        json_schema: Option<JsonValue>,
    },
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AiSafetyMode {
    Contextual,
    Strict,
}

impl AiSafetyMode {
    fn as_str(self) -> &'static str {
        match self {
            Self::Contextual => "CONTEXTUAL",
            Self::Strict => "STRICT",
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AiToolChoice {
    Required,
    None,
}

impl AiToolChoice {
    fn as_str(self) -> &'static str {
        match self {
            Self::Required => "REQUIRED",
            Self::None => "NONE",
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiThinking {
    #[serde(rename = "type")]
    kind: AiThinkingKind,
    token_budget: Option<u32>,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AiThinkingKind {
    Enabled,
    Disabled,
}

impl AiThinkingKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Enabled => "enabled",
            Self::Disabled => "disabled",
        }
    }
}

impl AiChatRequest {
    fn to_provider_value(&self) -> JsonValue {
        let mut body = JsonMap::new();
        body.insert("stream".into(), JsonValue::Bool(true));
        body.insert(
            "model".into(),
            JsonValue::String(self.model.as_str().into()),
        );
        body.insert(
            "messages".into(),
            JsonValue::Array(
                self.messages
                    .iter()
                    .map(AiChatMessage::to_provider_value)
                    .collect(),
            ),
        );
        if !self.tools.is_empty() {
            body.insert(
                "tools".into(),
                JsonValue::Array(
                    self.tools
                        .iter()
                        .map(AiToolDefinition::to_provider_value)
                        .collect(),
                ),
            );
        }
        if !self.documents.is_empty() {
            body.insert(
                "documents".into(),
                JsonValue::Array(
                    self.documents
                        .iter()
                        .map(AiChatDocument::to_provider_value)
                        .collect(),
                ),
            );
        }
        if let Some(mode) = self.citation_mode {
            body.insert(
                "citation_options".into(),
                json!({"mode": mode.provider_str()}),
            );
        }
        if let Some(format) = &self.response_format {
            body.insert("response_format".into(), format.to_provider_value());
        }
        if let Some(mode) = self.safety_mode {
            body.insert(
                "safety_mode".into(),
                JsonValue::String(mode.as_str().into()),
            );
        }
        insert_optional(&mut body, "max_tokens", self.max_tokens);
        if !self.stop_sequences.is_empty() {
            body.insert(
                "stop_sequences".into(),
                JsonValue::Array(
                    self.stop_sequences
                        .iter()
                        .cloned()
                        .map(JsonValue::String)
                        .collect(),
                ),
            );
        }
        insert_optional(&mut body, "temperature", self.temperature);
        insert_optional(&mut body, "seed", self.seed);
        insert_optional(&mut body, "frequency_penalty", self.frequency_penalty);
        insert_optional(&mut body, "presence_penalty", self.presence_penalty);
        insert_optional(&mut body, "k", self.k);
        insert_optional(&mut body, "p", self.p);
        if let Some(choice) = self.tool_choice {
            body.insert(
                "tool_choice".into(),
                JsonValue::String(choice.as_str().into()),
            );
        }
        if let Some(thinking) = &self.thinking {
            body.insert("thinking".into(), thinking.to_provider_value());
        }
        insert_optional(&mut body, "priority", self.priority);
        insert_optional(&mut body, "strict_tools", self.strict_tools);
        JsonValue::Object(body)
    }
}

fn insert_optional<T: Serialize>(
    map: &mut JsonMap<String, JsonValue>,
    key: &str,
    value: Option<T>,
) {
    if let Some(value) = value.and_then(|value| serde_json::to_value(value).ok()) {
        map.insert(key.to_string(), value);
    }
}

impl AiChatMessage {
    fn to_provider_value(&self) -> JsonValue {
        match self {
            Self::User { content } => {
                json!({"role": "user", "content": content.to_provider_value()})
            }
            Self::System { content } => json!({"role": "system", "content": content}),
            Self::Assistant {
                content,
                tool_plan,
                tool_calls,
            } => {
                let mut message = JsonMap::new();
                message.insert("role".into(), JsonValue::String("assistant".into()));
                if let Some(content) = content {
                    message.insert("content".into(), JsonValue::String(content.clone()));
                }
                if let Some(tool_plan) = tool_plan {
                    message.insert("tool_plan".into(), JsonValue::String(tool_plan.clone()));
                }
                if !tool_calls.is_empty() {
                    message.insert(
                        "tool_calls".into(),
                        JsonValue::Array(
                            tool_calls
                                .iter()
                                .map(AiToolCall::to_provider_value)
                                .collect(),
                        ),
                    );
                }
                JsonValue::Object(message)
            }
            Self::Tool {
                tool_call_id,
                content,
            } => json!({
                "role": "tool",
                "tool_call_id": tool_call_id,
                "content": content.to_provider_value(),
            }),
        }
    }
}

impl AiUserContent {
    fn to_provider_value(&self) -> JsonValue {
        match self {
            Self::Text(text) => JsonValue::String(text.clone()),
            Self::Blocks(blocks) => JsonValue::Array(
                blocks
                    .iter()
                    .map(AiUserContentBlock::to_provider_value)
                    .collect(),
            ),
        }
    }
}

impl AiUserContentBlock {
    fn to_provider_value(&self) -> JsonValue {
        match self {
            Self::Text { text } => json!({"type": "text", "text": text}),
            Self::ImageUrl { image_url } => {
                let mut image = JsonMap::new();
                image.insert("url".into(), JsonValue::String(image_url.url.clone()));
                if let Some(detail) = image_url.detail {
                    image.insert("detail".into(), JsonValue::String(detail.as_str().into()));
                }
                json!({"type": "image_url", "image_url": image})
            }
        }
    }
}

impl AiToolCall {
    fn to_provider_value(&self) -> JsonValue {
        let _ = self.kind;
        json!({
            "id": self.id,
            "type": "function",
            "function": {
                "name": self.function.name,
                "arguments": self.function.arguments,
            }
        })
    }
}

impl AiToolContent {
    fn to_provider_value(&self) -> JsonValue {
        match self {
            Self::Text(text) => JsonValue::String(text.clone()),
            Self::Blocks(blocks) => JsonValue::Array(
                blocks
                    .iter()
                    .map(AiToolContentBlock::to_provider_value)
                    .collect(),
            ),
        }
    }
}

impl AiToolContentBlock {
    fn to_provider_value(&self) -> JsonValue {
        match self {
            Self::Text { text } => json!({"type": "text", "text": text}),
            Self::Document { document } => {
                let mut value = JsonMap::new();
                if let Some(id) = &document.id {
                    value.insert("id".into(), JsonValue::String(id.clone()));
                }
                value.insert("data".into(), document.data.clone());
                json!({"type": "document", "document": value})
            }
        }
    }
}

impl AiToolDefinition {
    fn to_provider_value(&self) -> JsonValue {
        let mut function = JsonMap::new();
        function.insert("name".into(), JsonValue::String(self.name.clone()));
        function.insert("parameters".into(), self.parameters.clone());
        if let Some(description) = &self.description {
            function.insert("description".into(), JsonValue::String(description.clone()));
        }
        json!({"type": "function", "function": function})
    }
}

impl AiChatDocument {
    fn to_provider_value(&self) -> JsonValue {
        let mut document = JsonMap::new();
        if let Some(id) = &self.id {
            document.insert("id".into(), JsonValue::String(id.clone()));
        }
        document.insert("data".into(), JsonValue::Object(self.data.clone()));
        JsonValue::Object(document)
    }
}

impl AiResponseFormat {
    fn to_provider_value(&self) -> JsonValue {
        match self {
            Self::Text => json!({"type": "text"}),
            Self::JsonObject { json_schema } => {
                let mut value = JsonMap::new();
                value.insert("type".into(), JsonValue::String("json_object".into()));
                if let Some(schema) = json_schema {
                    value.insert("json_schema".into(), schema.clone());
                }
                JsonValue::Object(value)
            }
        }
    }
}

impl AiThinking {
    fn to_provider_value(&self) -> JsonValue {
        let mut value = JsonMap::new();
        value.insert("type".into(), JsonValue::String(self.kind.as_str().into()));
        insert_optional(&mut value, "token_budget", self.token_budget);
        JsonValue::Object(value)
    }
}

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

#[derive(Default)]
struct InputBudget {
    text_bytes: usize,
    image_bytes: usize,
    image_count: usize,
    json_nodes: usize,
}

fn validate_run_id(run_id: &str) -> Result<(), AiError> {
    if run_id.is_empty()
        || run_id.len() > 128
        || !run_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b':' | b'.'))
    {
        return Err(AiError::invalid(
            "runId must be 1-128 letters, numbers, dots, colons, dashes, or underscores",
        ));
    }
    Ok(())
}

fn validate_identifier(value: &str, label: &str, max: usize) -> Result<(), AiError> {
    if value.is_empty()
        || value.len() > max
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b':' | b'.'))
    {
        return Err(AiError::invalid(format!("{label} is not valid")));
    }
    Ok(())
}

fn add_text(budget: &mut InputBudget, text: &str, cap: usize) -> Result<(), AiError> {
    if text.len() > cap {
        return Err(AiError::invalid("AI text input exceeds its size limit"));
    }
    budget.text_bytes = budget
        .text_bytes
        .checked_add(text.len())
        .ok_or_else(|| AiError::invalid("AI text input is too large"))?;
    if budget.text_bytes > MAX_MESSAGE_TEXT_BYTES {
        return Err(AiError::invalid(
            "AI text input exceeds the 2 MB request cap",
        ));
    }
    Ok(())
}

fn validate_chat_request(request: &AiChatRequest) -> Result<JsonValue, AiError> {
    validate_run_id(&request.run_id)?;
    if request.messages.is_empty() || request.messages.len() > MAX_MESSAGES {
        return Err(AiError::invalid(
            "messages must contain between 1 and 128 entries",
        ));
    }
    if request.tools.len() > MAX_TOOLS {
        return Err(AiError::invalid("A request may define at most 48 tools"));
    }
    if request.documents.len() > MAX_DOCUMENTS {
        return Err(AiError::invalid(
            "A request may contain at most 128 documents",
        ));
    }
    if request.response_format.is_some()
        && (!request.tools.is_empty() || !request.documents.is_empty())
    {
        return Err(AiError::invalid(
            "responseFormat cannot be combined with tools or documents in Cohere V2",
        ));
    }
    if request.safety_mode.is_some() && (!request.tools.is_empty() || !request.documents.is_empty())
    {
        return Err(AiError::invalid(
            "safetyMode cannot be combined with tools or documents in Cohere V2",
        ));
    }
    if request.strict_tools == Some(true) && request.tools.is_empty() {
        return Err(AiError::invalid("strictTools requires at least one tool"));
    }
    if matches!(request.tool_choice, Some(AiToolChoice::Required)) && request.tools.is_empty() {
        return Err(AiError::invalid(
            "REQUIRED toolChoice requires at least one tool",
        ));
    }
    if let Some(tokens) = request.max_tokens {
        if tokens == 0 || tokens > 64_000 {
            return Err(AiError::invalid("maxTokens must be between 1 and 64000"));
        }
    }
    if request.stop_sequences.len() > 5
        || request
            .stop_sequences
            .iter()
            .any(|stop| stop.is_empty() || stop.len() > 256)
    {
        return Err(AiError::invalid(
            "stopSequences may contain at most five non-empty strings of 256 bytes",
        ));
    }
    validate_unit_float(request.temperature, "temperature", true)?;
    validate_unit_float(request.frequency_penalty, "frequencyPenalty", true)?;
    validate_unit_float(request.presence_penalty, "presencePenalty", true)?;
    if request.k.is_some_and(|k| k > 500) {
        return Err(AiError::invalid("k must be between 0 and 500"));
    }
    if request
        .p
        .is_some_and(|p| !p.is_finite() || !(0.01..=0.99).contains(&p))
    {
        return Err(AiError::invalid("p must be between 0.01 and 0.99"));
    }
    if request.priority.is_some_and(|priority| priority > 999) {
        return Err(AiError::invalid("priority must be between 0 and 999"));
    }
    if let Some(thinking) = &request.thinking {
        match (thinking.kind, thinking.token_budget) {
            (AiThinkingKind::Disabled, Some(_)) => {
                return Err(AiError::invalid(
                    "thinking.tokenBudget is only valid when thinking is enabled",
                ));
            }
            (AiThinkingKind::Enabled, Some(0 | 64_001..)) => {
                return Err(AiError::invalid(
                    "thinking.tokenBudget must be between 1 and 64000",
                ));
            }
            _ => {}
        }
    }

    let mut budget = InputBudget::default();
    for (index, message) in request.messages.iter().enumerate() {
        validate_chat_message(message, &mut budget)
            .map_err(|error| prefix_invalid(error, &format!("messages[{index}]")))?;
    }

    let mut names = HashSet::new();
    let mut schema_bytes = 0usize;
    for tool in &request.tools {
        validate_identifier(&tool.name, "tool name", 64)?;
        if !names.insert(tool.name.as_str()) {
            return Err(AiError::invalid("Tool names must be unique"));
        }
        if let Some(description) = &tool.description {
            if description.is_empty() || description.len() > 4096 {
                return Err(AiError::invalid(
                    "Tool descriptions must be 1-4096 bytes when supplied",
                ));
            }
        }
        validate_json_schema(&tool.parameters, true)?;
        schema_bytes = schema_bytes
            .checked_add(serialized_len(&tool.parameters)?)
            .ok_or_else(|| AiError::invalid("Tool schemas are too large"))?;
        if schema_bytes > MAX_TOOL_SCHEMA_BYTES {
            return Err(AiError::invalid(
                "Tool schemas exceed the 256 KB request cap",
            ));
        }
    }

    let mut document_bytes = 0usize;
    for document in &request.documents {
        if let Some(id) = &document.id {
            validate_identifier(id, "document id", 128)?;
        }
        let value = JsonValue::Object(document.data.clone());
        validate_general_json(&value, &mut budget)?;
        document_bytes = document_bytes
            .checked_add(serialized_len(&value)?)
            .ok_or_else(|| AiError::invalid("Documents are too large"))?;
        if document_bytes > MAX_DOCUMENT_BYTES {
            return Err(AiError::invalid("Documents exceed the 2 MB request cap"));
        }
    }

    if let Some(AiResponseFormat::JsonObject {
        json_schema: Some(schema),
    }) = &request.response_format
    {
        validate_json_schema(schema, true)?;
        if serialized_len(schema)? > MAX_TOOL_SCHEMA_BYTES {
            return Err(AiError::invalid("responseFormat schema exceeds 256 KB"));
        }
    }

    let provider = request.to_provider_value();
    if serialized_len(&provider)? > MAX_REQUEST_BYTES {
        return Err(AiError::invalid(
            "Cohere request exceeds the 32 MB body cap",
        ));
    }
    Ok(provider)
}

fn validate_unit_float(value: Option<f64>, label: &str, allow_zero: bool) -> Result<(), AiError> {
    if let Some(value) = value {
        let range = if allow_zero {
            0.0..=1.0
        } else {
            f64::EPSILON..=1.0
        };
        if !value.is_finite() || !range.contains(&value) {
            return Err(AiError::invalid(format!("{label} must be between 0 and 1")));
        }
    }
    Ok(())
}

fn validate_chat_message(message: &AiChatMessage, budget: &mut InputBudget) -> Result<(), AiError> {
    match message {
        AiChatMessage::User { content } => match content {
            AiUserContent::Text(text) => add_text(budget, text, 1024 * 1024),
            AiUserContent::Blocks(blocks) => {
                if blocks.is_empty() || blocks.len() > 64 {
                    return Err(AiError::invalid(
                        "user content blocks must contain between 1 and 64 entries",
                    ));
                }
                for block in blocks {
                    match block {
                        AiUserContentBlock::Text { text } => add_text(budget, text, 1024 * 1024)?,
                        AiUserContentBlock::ImageUrl { image_url } => {
                            let bytes = validate_image_data_uri(&image_url.url)?;
                            budget.image_count += 1;
                            budget.image_bytes += bytes;
                            if budget.image_count > MAX_IMAGES
                                || budget.image_bytes > MAX_IMAGE_BYTES
                            {
                                return Err(AiError::invalid(
                                    "A chat request may contain at most 20 images and 20 MB of image data",
                                ));
                            }
                        }
                    }
                }
                Ok(())
            }
        },
        AiChatMessage::System { content } => add_text(budget, content, 512 * 1024),
        AiChatMessage::Assistant {
            content,
            tool_plan,
            tool_calls,
        } => {
            if content.is_none() && tool_plan.is_none() && tool_calls.is_empty() {
                return Err(AiError::invalid("assistant message is empty"));
            }
            if let Some(content) = content {
                add_text(budget, content, 1024 * 1024)?;
            }
            if let Some(plan) = tool_plan {
                add_text(budget, plan, 128 * 1024)?;
            }
            if tool_calls.len() > MAX_TOOLS {
                return Err(AiError::invalid(
                    "assistant message contains too many tool calls",
                ));
            }
            for call in tool_calls {
                validate_identifier(&call.id, "tool call id", 128)?;
                validate_identifier(&call.function.name, "tool call function name", 64)?;
                if call.function.arguments.len() > 256 * 1024
                    || serde_json::from_str::<JsonValue>(&call.function.arguments).is_err()
                {
                    return Err(AiError::invalid(
                        "tool call arguments must be valid JSON under 256 KB",
                    ));
                }
            }
            Ok(())
        }
        AiChatMessage::Tool {
            tool_call_id,
            content,
        } => {
            validate_identifier(tool_call_id, "toolCallId", 128)?;
            match content {
                AiToolContent::Text(text) => add_text(budget, text, 512 * 1024),
                AiToolContent::Blocks(blocks) => {
                    if blocks.is_empty() || blocks.len() > 128 {
                        return Err(AiError::invalid(
                            "tool content blocks must contain between 1 and 128 entries",
                        ));
                    }
                    for block in blocks {
                        match block {
                            AiToolContentBlock::Text { text } => {
                                add_text(budget, text, 512 * 1024)?;
                            }
                            AiToolContentBlock::Document { document } => {
                                if let Some(id) = &document.id {
                                    validate_identifier(id, "tool document id", 128)?;
                                }
                                validate_general_json(&document.data, budget)?;
                                if serialized_len(&document.data)? > 512 * 1024 {
                                    return Err(AiError::invalid(
                                        "A tool result document may not exceed 512 KB",
                                    ));
                                }
                            }
                        }
                    }
                    Ok(())
                }
            }
        }
    }
}

fn prefix_invalid(mut error: AiError, prefix: &str) -> AiError {
    error.message = format!("{prefix}: {}", error.message);
    error
}

fn serialized_len(value: &JsonValue) -> Result<usize, AiError> {
    serde_json::to_vec(value)
        .map(|bytes| bytes.len())
        .map_err(|_| AiError::invalid("Request contains invalid JSON"))
}

fn validate_general_json(value: &JsonValue, budget: &mut InputBudget) -> Result<(), AiError> {
    fn walk(value: &JsonValue, depth: usize, budget: &mut InputBudget) -> Result<(), AiError> {
        if depth > MAX_JSON_DEPTH {
            return Err(AiError::invalid(
                "JSON input exceeds the maximum nesting depth",
            ));
        }
        budget.json_nodes += 1;
        if budget.json_nodes > MAX_JSON_NODES {
            return Err(AiError::invalid("JSON input contains too many values"));
        }
        match value {
            JsonValue::Null | JsonValue::Bool(_) => Ok(()),
            JsonValue::Number(number) if number.as_f64().is_some_and(f64::is_finite) => Ok(()),
            JsonValue::Number(_) => Err(AiError::invalid("JSON numbers must be finite")),
            JsonValue::String(text) => add_text(budget, text, 512 * 1024),
            JsonValue::Array(values) => {
                if values.len() > 4096 {
                    return Err(AiError::invalid("JSON array contains too many entries"));
                }
                for value in values {
                    walk(value, depth + 1, budget)?;
                }
                Ok(())
            }
            JsonValue::Object(values) => {
                if values.len() > 1024 {
                    return Err(AiError::invalid("JSON object contains too many fields"));
                }
                for (key, value) in values {
                    if key.is_empty() || key.len() > 256 || key.chars().any(char::is_control) {
                        return Err(AiError::invalid(
                            "JSON object contains an invalid field name",
                        ));
                    }
                    walk(value, depth + 1, budget)?;
                }
                Ok(())
            }
        }
    }
    walk(value, 0, budget)
}

fn validate_json_schema(schema: &JsonValue, require_object: bool) -> Result<(), AiError> {
    const ALLOWED: &[&str] = &[
        "type",
        "properties",
        "required",
        "description",
        "enum",
        "const",
        "pattern",
        "format",
        "$ref",
        "$defs",
        "additionalProperties",
        "anyOf",
        "items",
    ];

    fn walk(schema: &JsonValue, depth: usize) -> Result<(), AiError> {
        if depth > MAX_JSON_DEPTH {
            return Err(AiError::invalid("JSON Schema is nested too deeply"));
        }
        let object = schema
            .as_object()
            .ok_or_else(|| AiError::invalid("Each JSON Schema node must be an object"))?;
        for key in object.keys() {
            if !ALLOWED.contains(&key.as_str()) {
                return Err(AiError::invalid(format!(
                    "JSON Schema keyword '{key}' is not supported by Cohere"
                )));
            }
        }
        if let Some(kind) = object.get("type") {
            let valid = match kind {
                JsonValue::String(kind) => matches!(
                    kind.as_str(),
                    "object" | "array" | "string" | "integer" | "number" | "boolean" | "null"
                ),
                JsonValue::Array(kinds) => {
                    !kinds.is_empty()
                        && kinds.iter().all(|kind| {
                            kind.as_str().is_some_and(|kind| {
                                matches!(
                                    kind,
                                    "object"
                                        | "array"
                                        | "string"
                                        | "integer"
                                        | "number"
                                        | "boolean"
                                        | "null"
                                )
                            })
                        })
                }
                _ => false,
            };
            if !valid {
                return Err(AiError::invalid("JSON Schema contains an invalid type"));
            }
        }
        if let Some(properties) = object.get("properties") {
            let properties = properties
                .as_object()
                .ok_or_else(|| AiError::invalid("schema.properties must be an object"))?;
            if properties.len() > 256 {
                return Err(AiError::invalid("JSON Schema has too many properties"));
            }
            for (name, property) in properties {
                if name.is_empty() || name.len() > 128 || name.chars().any(char::is_control) {
                    return Err(AiError::invalid("JSON Schema has an invalid property name"));
                }
                walk(property, depth + 1)?;
            }
        }
        if let Some(required) = object.get("required") {
            let required = required
                .as_array()
                .ok_or_else(|| AiError::invalid("schema.required must be an array"))?;
            if required.is_empty()
                || required.len() > 256
                || required.iter().any(|name| name.as_str().is_none())
            {
                return Err(AiError::invalid(
                    "schema.required must list between 1 and 256 property names",
                ));
            }
        }
        if let Some(items) = object.get("items") {
            walk(items, depth + 1)?;
        }
        if let Some(any_of) = object.get("anyOf") {
            let any_of = any_of
                .as_array()
                .ok_or_else(|| AiError::invalid("schema.anyOf must be an array"))?;
            if !(1..=16).contains(&any_of.len()) {
                return Err(AiError::invalid("schema.anyOf must contain 1-16 schemas"));
            }
            for item in any_of {
                walk(item, depth + 1)?;
            }
        }
        if let Some(definitions) = object.get("$defs") {
            let definitions = definitions
                .as_object()
                .ok_or_else(|| AiError::invalid("schema.$defs must be an object"))?;
            if definitions.len() > 128 {
                return Err(AiError::invalid(
                    "schema.$defs contains too many definitions",
                ));
            }
            for definition in definitions.values() {
                walk(definition, depth + 1)?;
            }
        }
        if let Some(reference) = object.get("$ref") {
            if !reference.as_str().is_some_and(|reference| {
                reference.starts_with("#/$defs/") && reference.len() <= 256
            }) {
                return Err(AiError::invalid(
                    "Only local #/$defs JSON Schema references are allowed",
                ));
            }
        }
        if let Some(pattern) = object.get("pattern") {
            let pattern = pattern
                .as_str()
                .ok_or_else(|| AiError::invalid("schema.pattern must be a string"))?;
            if pattern.len() > 512
                || ["^", "$", "?=", "?!"]
                    .iter()
                    .any(|token| pattern.contains(token))
            {
                return Err(AiError::invalid(
                    "schema.pattern uses syntax Cohere does not support",
                ));
            }
        }
        if let Some(format) = object.get("format") {
            if !format
                .as_str()
                .is_some_and(|format| matches!(format, "date-time" | "uuid" | "date" | "time"))
            {
                return Err(AiError::invalid("schema.format is not supported by Cohere"));
            }
        }
        if let Some(description) = object.get("description") {
            if !description
                .as_str()
                .is_some_and(|description| description.len() <= 4096)
            {
                return Err(AiError::invalid(
                    "schema.description must be at most 4096 bytes",
                ));
            }
        }
        if let Some(enum_values) = object.get("enum") {
            if !enum_values
                .as_array()
                .is_some_and(|values| !values.is_empty() && values.len() <= 256)
            {
                return Err(AiError::invalid("schema.enum must contain 1-256 values"));
            }
        }
        Ok(())
    }

    walk(schema, 0)?;
    if require_object
        && schema
            .get("type")
            .and_then(JsonValue::as_str)
            .is_none_or(|kind| kind != "object")
    {
        return Err(AiError::invalid(
            "The top-level JSON Schema type must be object",
        ));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Embed v4 and Rerank v4 contracts
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, Deserialize)]
pub enum AiEmbedModel {
    #[serde(rename = "embed-v4.0")]
    EmbedV40,
}

impl AiEmbedModel {
    fn as_str(self) -> &'static str {
        match self {
            Self::EmbedV40 => "embed-v4.0",
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiEmbedInputType {
    SearchDocument,
    SearchQuery,
    Classification,
    Clustering,
    Image,
}

impl AiEmbedInputType {
    fn as_str(self) -> &'static str {
        match self {
            Self::SearchDocument => "search_document",
            Self::SearchQuery => "search_query",
            Self::Classification => "classification",
            Self::Clustering => "clustering",
            Self::Image => "image",
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AiEmbeddingType {
    Float,
    Int8,
    Uint8,
    Binary,
    Ubinary,
    Base64,
}

impl AiEmbeddingType {
    fn as_str(self) -> &'static str {
        match self {
            Self::Float => "float",
            Self::Int8 => "int8",
            Self::Uint8 => "uint8",
            Self::Binary => "binary",
            Self::Ubinary => "ubinary",
            Self::Base64 => "base64",
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize)]
pub enum AiTruncate {
    #[serde(rename = "NONE")]
    None,
    #[serde(rename = "START")]
    Start,
    #[serde(rename = "END")]
    End,
}

impl AiTruncate {
    fn as_str(self) -> &'static str {
        match self {
            Self::None => "NONE",
            Self::Start => "START",
            Self::End => "END",
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiEmbedRequest {
    run_id: String,
    model: AiEmbedModel,
    input_type: AiEmbedInputType,
    inputs: Vec<AiEmbedInput>,
    max_tokens: Option<u32>,
    output_dimension: Option<u16>,
    #[serde(default)]
    embedding_types: Vec<AiEmbeddingType>,
    truncate: Option<AiTruncate>,
    priority: Option<u16>,
}

#[derive(Deserialize)]
pub struct AiEmbedInput {
    content: Vec<AiEmbedContentBlock>,
}

#[derive(Deserialize)]
#[serde(tag = "type")]
pub enum AiEmbedContentBlock {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "image_url")]
    ImageUrl {
        #[serde(rename = "imageUrl")]
        image_url: AiEmbedImageUrl,
    },
}

#[derive(Deserialize)]
pub struct AiEmbedImageUrl {
    url: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiEmbedResponse {
    pub id: String,
    pub embeddings: AiEmbeddingValues,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AiEmbeddingValues {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub float: Option<Vec<Vec<f64>>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub int8: Option<Vec<Vec<i16>>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub uint8: Option<Vec<Vec<u16>>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub binary: Option<Vec<Vec<i16>>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ubinary: Option<Vec<Vec<u16>>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base64: Option<Vec<String>>,
}

impl AiEmbedRequest {
    fn validate_and_build(&self) -> Result<JsonValue, AiError> {
        validate_run_id(&self.run_id)?;
        if self.inputs.is_empty() || self.inputs.len() > 96 {
            return Err(AiError::invalid(
                "Embed inputs must contain between 1 and 96 entries",
            ));
        }
        if self.embedding_types.len() > 6 {
            return Err(AiError::invalid("At most six embeddingTypes are supported"));
        }
        let mut seen_types = HashSet::new();
        for kind in &self.embedding_types {
            if !seen_types.insert(kind.as_str()) {
                return Err(AiError::invalid(
                    "embeddingTypes must not contain duplicates",
                ));
            }
        }
        if self
            .output_dimension
            .is_some_and(|dimension| !matches!(dimension, 256 | 512 | 1024 | 1536))
        {
            return Err(AiError::invalid(
                "outputDimension must be 256, 512, 1024, or 1536",
            ));
        }
        if self
            .max_tokens
            .is_some_and(|tokens| tokens == 0 || tokens > 128_000)
        {
            return Err(AiError::invalid("maxTokens must be between 1 and 128000"));
        }
        if self.priority.is_some_and(|priority| priority > 999) {
            return Err(AiError::invalid("priority must be between 0 and 999"));
        }

        let mut budget = InputBudget::default();
        let mut has_image = false;
        for input in &self.inputs {
            if input.content.is_empty() || input.content.len() > 64 {
                return Err(AiError::invalid(
                    "Each Embed input must contain between 1 and 64 content blocks",
                ));
            }
            for content in &input.content {
                match content {
                    AiEmbedContentBlock::Text { text } => {
                        add_text(&mut budget, text, 1024 * 1024)?;
                    }
                    AiEmbedContentBlock::ImageUrl { image_url } => {
                        let bytes = validate_image_data_uri(&image_url.url)?;
                        budget.image_count += 1;
                        budget.image_bytes += bytes;
                        has_image = true;
                        if budget.image_count > MAX_IMAGES || budget.image_bytes > MAX_IMAGE_BYTES {
                            return Err(AiError::invalid(
                                "Embed inputs may contain at most 20 images and 20 MB of image data",
                            ));
                        }
                    }
                }
            }
        }
        if has_image && !matches!(self.input_type, AiEmbedInputType::Image) {
            return Err(AiError::invalid(
                "Embed requests containing images must use inputType 'image'",
            ));
        }

        let mut body = JsonMap::new();
        body.insert(
            "model".into(),
            JsonValue::String(self.model.as_str().into()),
        );
        body.insert(
            "input_type".into(),
            JsonValue::String(self.input_type.as_str().into()),
        );
        body.insert(
            "inputs".into(),
            JsonValue::Array(
                self.inputs
                    .iter()
                    .map(|input| {
                        json!({
                            "content": input.content.iter().map(|content| match content {
                                AiEmbedContentBlock::Text { text } => json!({"type": "text", "text": text}),
                                AiEmbedContentBlock::ImageUrl { image_url } => json!({
                                    "type": "image_url",
                                    "image_url": {"url": image_url.url},
                                }),
                            }).collect::<Vec<_>>()
                        })
                    })
                    .collect(),
            ),
        );
        insert_optional(&mut body, "max_tokens", self.max_tokens);
        insert_optional(&mut body, "output_dimension", self.output_dimension);
        if !self.embedding_types.is_empty() {
            body.insert(
                "embedding_types".into(),
                JsonValue::Array(
                    self.embedding_types
                        .iter()
                        .map(|kind| JsonValue::String(kind.as_str().into()))
                        .collect(),
                ),
            );
        }
        if let Some(truncate) = self.truncate {
            body.insert(
                "truncate".into(),
                JsonValue::String(truncate.as_str().into()),
            );
        }
        insert_optional(&mut body, "priority", self.priority);
        let body = JsonValue::Object(body);
        if serialized_len(&body)? > MAX_REQUEST_BYTES {
            return Err(AiError::invalid("Embed request exceeds the 32 MB body cap"));
        }
        Ok(body)
    }
}

#[derive(Debug, Clone, Copy, Deserialize)]
pub enum AiRerankModel {
    #[serde(rename = "rerank-v4.0-pro")]
    RerankV40Pro,
    #[serde(rename = "rerank-v4.0-fast")]
    RerankV40Fast,
}

impl AiRerankModel {
    fn as_str(self) -> &'static str {
        match self {
            Self::RerankV40Pro => "rerank-v4.0-pro",
            Self::RerankV40Fast => "rerank-v4.0-fast",
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiRerankRequest {
    run_id: String,
    model: AiRerankModel,
    query: String,
    documents: Vec<String>,
    top_n: Option<u16>,
    max_tokens_per_doc: Option<u32>,
    priority: Option<u16>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiRerankResponse {
    pub id: Option<String>,
    pub results: Vec<AiRerankResult>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiRerankResult {
    pub index: usize,
    #[serde(
        rename(serialize = "relevanceScore", deserialize = "relevance_score"),
        alias = "relevanceScore"
    )]
    pub relevance_score: f64,
}

impl AiRerankRequest {
    fn validate_and_build(&self) -> Result<JsonValue, AiError> {
        validate_run_id(&self.run_id)?;
        if self.query.is_empty() || self.query.len() > 64 * 1024 {
            return Err(AiError::invalid("Rerank query must be 1-65536 bytes"));
        }
        if self.documents.is_empty() || self.documents.len() > 1000 {
            return Err(AiError::invalid(
                "Rerank documents must contain between 1 and 1000 entries",
            ));
        }
        let mut total = self.query.len();
        for document in &self.documents {
            if document.is_empty() || document.len() > 512 * 1024 {
                return Err(AiError::invalid(
                    "Each Rerank document must be 1-524288 bytes",
                ));
            }
            total = total
                .checked_add(document.len())
                .ok_or_else(|| AiError::invalid("Rerank documents are too large"))?;
        }
        if total > 4 * 1024 * 1024 {
            return Err(AiError::invalid("Rerank text exceeds the 4 MB request cap"));
        }
        if self
            .top_n
            .is_some_and(|top| top == 0 || usize::from(top) > self.documents.len())
        {
            return Err(AiError::invalid(
                "topN must be between 1 and the number of documents",
            ));
        }
        if self
            .max_tokens_per_doc
            .is_some_and(|tokens| tokens == 0 || tokens > 32_768)
        {
            return Err(AiError::invalid(
                "maxTokensPerDoc must be between 1 and 32768",
            ));
        }
        if self.priority.is_some_and(|priority| priority > 999) {
            return Err(AiError::invalid("priority must be between 0 and 999"));
        }

        let mut body = JsonMap::new();
        body.insert(
            "model".into(),
            JsonValue::String(self.model.as_str().into()),
        );
        body.insert("query".into(), JsonValue::String(self.query.clone()));
        body.insert(
            "documents".into(),
            JsonValue::Array(
                self.documents
                    .iter()
                    .cloned()
                    .map(JsonValue::String)
                    .collect(),
            ),
        );
        insert_optional(&mut body, "top_n", self.top_n);
        insert_optional(&mut body, "max_tokens_per_doc", self.max_tokens_per_doc);
        insert_optional(&mut body, "priority", self.priority);
        Ok(JsonValue::Object(body))
    }
}

// ---------------------------------------------------------------------------
// HTTP, retry, streaming, and cancellation
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
pub enum AiProviderEventType {
    #[serde(rename = "message-start")]
    MessageStart,
    #[serde(rename = "content-start")]
    ContentStart,
    #[serde(rename = "content-delta")]
    ContentDelta,
    #[serde(rename = "content-end")]
    ContentEnd,
    #[serde(rename = "tool-plan-delta")]
    ToolPlanDelta,
    #[serde(rename = "tool-call-start")]
    ToolCallStart,
    #[serde(rename = "tool-call-delta")]
    ToolCallDelta,
    #[serde(rename = "tool-call-end")]
    ToolCallEnd,
    #[serde(rename = "citation-start")]
    CitationStart,
    #[serde(rename = "citation-end")]
    CitationEnd,
    #[serde(rename = "message-end")]
    MessageEnd,
    #[serde(rename = "debug")]
    Debug,
}

impl AiProviderEventType {
    fn parse(value: &str) -> Option<Self> {
        Some(match value {
            "message-start" => Self::MessageStart,
            "content-start" => Self::ContentStart,
            "content-delta" => Self::ContentDelta,
            "content-end" => Self::ContentEnd,
            "tool-plan-delta" => Self::ToolPlanDelta,
            "tool-call-start" => Self::ToolCallStart,
            "tool-call-delta" => Self::ToolCallDelta,
            "tool-call-end" => Self::ToolCallEnd,
            "citation-start" => Self::CitationStart,
            "citation-end" => Self::CitationEnd,
            "message-end" => Self::MessageEnd,
            "debug" => Self::Debug,
            _ => return None,
        })
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::MessageStart => "message-start",
            Self::ContentStart => "content-start",
            Self::ContentDelta => "content-delta",
            Self::ContentEnd => "content-end",
            Self::ToolPlanDelta => "tool-plan-delta",
            Self::ToolCallStart => "tool-call-start",
            Self::ToolCallDelta => "tool-call-delta",
            Self::ToolCallEnd => "tool-call-end",
            Self::CitationStart => "citation-start",
            Self::CitationEnd => "citation-end",
            Self::MessageEnd => "message-end",
            Self::Debug => "debug",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AiStreamEvent {
    ProviderEvent {
        #[serde(rename = "runId")]
        run_id: String,
        sequence: u64,
        #[serde(rename = "eventType")]
        event_type: AiProviderEventType,
        data: JsonValue,
    },
    Retry {
        #[serde(rename = "runId")]
        run_id: String,
        attempt: u8,
        #[serde(rename = "retryAfterMs")]
        retry_after_ms: u64,
    },
    Completed {
        #[serde(rename = "runId")]
        run_id: String,
    },
    Cancelled {
        #[serde(rename = "runId")]
        run_id: String,
    },
    Error {
        #[serde(rename = "runId")]
        run_id: String,
        error: AiError,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiCancelResult {
    pub run_id: String,
    pub cancelled: bool,
}

fn status_error(status: StatusCode) -> AiError {
    match status.as_u16() {
        401 | 498 => AiError::new(
            AiErrorCode::Authentication,
            "Cohere rejected the configured API key",
            false,
        ),
        403 => AiError::new(
            AiErrorCode::PermissionDenied,
            "This Cohere key does not have access to the requested model or endpoint",
            false,
        ),
        408 | 504 => AiError::new(AiErrorCode::Timeout, "Cohere did not respond in time", true),
        429 => AiError::new(
            AiErrorCode::RateLimited,
            "Cohere is rate limiting requests; try again shortly",
            true,
        ),
        500..=599 => AiError::new(
            AiErrorCode::ProviderUnavailable,
            "Cohere is temporarily unavailable",
            true,
        ),
        _ => AiError::new(
            AiErrorCode::InvalidRequest,
            "Cohere rejected the normalized request",
            false,
        ),
    }
    .with_status(status)
}

fn network_error(error: &reqwest::Error) -> AiError {
    if error.is_timeout() {
        AiError::new(AiErrorCode::Timeout, "The Cohere request timed out", true)
    } else {
        AiError::new(
            AiErrorCode::Network,
            "Could not reach Cohere over HTTPS",
            true,
        )
    }
}

fn is_retryable_status(status: StatusCode) -> bool {
    status == StatusCode::REQUEST_TIMEOUT
        || status == StatusCode::TOO_MANY_REQUESTS
        || status.is_server_error()
}

fn retry_delay(headers: &header::HeaderMap, failed_attempt: u8) -> Duration {
    if let Some(value) = headers
        .get(header::RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
    {
        if let Ok(seconds) = value.trim().parse::<u64>() {
            return Duration::from_secs(seconds).min(MAX_RETRY_DELAY);
        }
        if let Ok(when) = httpdate::parse_http_date(value) {
            if let Ok(delay) = when.duration_since(SystemTime::now()) {
                return delay.min(MAX_RETRY_DELAY);
            }
            return Duration::ZERO;
        }
    }
    let base_ms = 500u64.saturating_mul(1u64 << failed_attempt.saturating_sub(1));
    let jitter_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| u64::from(duration.subsec_nanos()) % 251)
        .unwrap_or(0);
    Duration::from_millis(base_ms.saturating_add(jitter_ms)).min(MAX_RETRY_DELAY)
}

async fn cancellable_sleep(control: &RunControl, delay: Duration) -> Result<(), AiError> {
    control.wait(tokio::time::sleep(delay)).await.map(|_| ())
}

async fn read_response_capped(
    mut response: reqwest::Response,
    cap: usize,
    control: &RunControl,
) -> Result<Vec<u8>, AiError> {
    if response
        .content_length()
        .is_some_and(|length| length > cap as u64)
    {
        return Err(AiError::new(
            AiErrorCode::ProviderProtocol,
            "Cohere response exceeded the allowed size",
            false,
        ));
    }
    let mut body = Vec::new();
    loop {
        let chunk = control
            .wait(response.chunk())
            .await?
            .map_err(|error| network_error(&error))?;
        let Some(chunk) = chunk else { break };
        if body.len().saturating_add(chunk.len()) > cap {
            return Err(AiError::new(
                AiErrorCode::ProviderProtocol,
                "Cohere response exceeded the allowed size",
                false,
            ));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

async fn send_json_with_retry(
    state: &AiState,
    key: &SecretString,
    control: &RunControl,
    path: &str,
    body: &JsonValue,
) -> Result<Vec<u8>, AiError> {
    for attempt in 1..=MAX_ATTEMPTS {
        let response = control
            .wait(
                state
                    .client
                    .post(format!("{COHERE_ORIGIN}{path}"))
                    .header(header::ACCEPT, "application/json")
                    .header("X-Client-Name", CLIENT_NAME)
                    .bearer_auth(key.expose())
                    .json(body)
                    .send(),
            )
            .await?;
        match response {
            Ok(response) => {
                let status = response.status();
                if status.is_success() {
                    return read_response_capped(response, MAX_JSON_RESPONSE_BYTES, control).await;
                }
                if is_retryable_status(status) && attempt < MAX_ATTEMPTS {
                    let delay = retry_delay(response.headers(), attempt);
                    drop(response);
                    cancellable_sleep(control, delay).await?;
                    continue;
                }
                return Err(status_error(status));
            }
            Err(error) => {
                let mapped = network_error(&error);
                if mapped.retryable && attempt < MAX_ATTEMPTS {
                    cancellable_sleep(control, retry_delay(&header::HeaderMap::new(), attempt))
                        .await?;
                    continue;
                }
                return Err(mapped);
            }
        }
    }
    Err(AiError::internal())
}

async fn test_api_key(
    state: &AiState,
    key: &SecretString,
    control: &RunControl,
) -> Result<bool, AiError> {
    for attempt in 1..=MAX_ATTEMPTS {
        let response = control
            .wait(
                state
                    .client
                    .post(format!("{COHERE_ORIGIN}/v1/check-api-key"))
                    .header(header::ACCEPT, "application/json")
                    .header("X-Client-Name", CLIENT_NAME)
                    .bearer_auth(key.expose())
                    .send(),
            )
            .await?;
        match response {
            Ok(response) => {
                let status = response.status();
                if matches!(status.as_u16(), 401 | 403 | 498) {
                    return Ok(false);
                }
                if status.is_success() {
                    let body = read_response_capped(response, 64 * 1024, control).await?;
                    let value: JsonValue = serde_json::from_slice(&body).map_err(|_| {
                        AiError::new(
                            AiErrorCode::ProviderProtocol,
                            "Cohere returned an invalid key-check response",
                            false,
                        )
                    })?;
                    return value
                        .get("valid")
                        .and_then(JsonValue::as_bool)
                        .ok_or_else(|| {
                            AiError::new(
                                AiErrorCode::ProviderProtocol,
                                "Cohere returned an invalid key-check response",
                                false,
                            )
                        });
                }
                if is_retryable_status(status) && attempt < MAX_ATTEMPTS {
                    let delay = retry_delay(response.headers(), attempt);
                    drop(response);
                    cancellable_sleep(control, delay).await?;
                    continue;
                }
                return Err(status_error(status));
            }
            Err(error) => {
                let mapped = network_error(&error);
                if mapped.retryable && attempt < MAX_ATTEMPTS {
                    cancellable_sleep(control, retry_delay(&header::HeaderMap::new(), attempt))
                        .await?;
                    continue;
                }
                return Err(mapped);
            }
        }
    }
    Err(AiError::internal())
}

#[tauri::command]
pub async fn ai_credential_test(
    state: tauri::State<'_, AiState>,
    request: AiCredentialTestRequest,
) -> Result<AiCredentialTestResult, AiError> {
    let state = state.inner().clone();
    let state_for_registration = state.clone();
    let (key, control, _active_run) = tauri::async_runtime::spawn_blocking(move || {
        state_for_registration.register_credential_test_run(request.api_key)
    })
    .await
    .map_err(|_| AiError::internal())??;
    let valid = tokio::time::timeout(JSON_DEADLINE, test_api_key(&state, &key, &control))
        .await
        .map_err(|_| AiError::new(AiErrorCode::Timeout, "Cohere key test timed out", true))??;
    Ok(AiCredentialTestResult { valid })
}

#[tauri::command]
pub fn ai_cancel_run(
    state: tauri::State<'_, AiState>,
    run_id: String,
) -> Result<AiCancelResult, AiError> {
    validate_run_id(&run_id)?;
    state.cancel_run(&run_id)?;
    // `true` means the cancellation intent was accepted. It may have cancelled
    // an active request or armed the one-shot pre-registration barrier above.
    Ok(AiCancelResult {
        run_id,
        cancelled: true,
    })
}

struct SseDecoder {
    buffer: Vec<u8>,
    total_bytes: usize,
}

impl SseDecoder {
    fn new() -> Self {
        Self {
            buffer: Vec::new(),
            total_bytes: 0,
        }
    }

    fn push(&mut self, chunk: &[u8]) -> Result<Vec<(String, String)>, AiError> {
        self.total_bytes = self.total_bytes.saturating_add(chunk.len());
        if self.total_bytes > MAX_STREAM_BYTES {
            return Err(AiError::new(
                AiErrorCode::ProviderProtocol,
                "Cohere stream exceeded the allowed size",
                false,
            ));
        }
        self.buffer.extend_from_slice(chunk);
        if self.buffer.len() > MAX_SSE_FRAME_BYTES && find_sse_frame_end(&self.buffer).is_none() {
            return Err(AiError::new(
                AiErrorCode::ProviderProtocol,
                "Cohere sent an oversized stream event",
                false,
            ));
        }
        let mut events = Vec::new();
        while let Some(end) = find_sse_frame_end(&self.buffer) {
            let frame: Vec<u8> = self.buffer.drain(..end).collect();
            if frame.len() > MAX_SSE_FRAME_BYTES {
                return Err(AiError::new(
                    AiErrorCode::ProviderProtocol,
                    "Cohere sent an oversized stream event",
                    false,
                ));
            }
            if let Some(event) = parse_sse_frame(&frame)? {
                events.push(event);
            }
        }
        Ok(events)
    }

    fn finish(self) -> Result<(), AiError> {
        if self.buffer.iter().all(u8::is_ascii_whitespace) {
            Ok(())
        } else {
            Err(AiError::new(
                AiErrorCode::ProviderProtocol,
                "Cohere ended the stream mid-event",
                false,
            ))
        }
    }
}

fn find_sse_frame_end(buffer: &[u8]) -> Option<usize> {
    let mut line_start = 0usize;
    for (index, byte) in buffer.iter().enumerate() {
        if *byte == b'\n' {
            let line = &buffer[line_start..index];
            if line.is_empty() || line == b"\r" {
                return Some(index + 1);
            }
            line_start = index + 1;
        }
    }
    None
}

fn parse_sse_frame(frame: &[u8]) -> Result<Option<(String, String)>, AiError> {
    let text = std::str::from_utf8(frame).map_err(|_| {
        AiError::new(
            AiErrorCode::ProviderProtocol,
            "Cohere sent non-UTF-8 stream data",
            false,
        )
    })?;
    let mut event = None;
    let mut data = Vec::new();
    for raw_line in text.lines() {
        let line = raw_line.trim_end_matches('\r');
        if line.is_empty() || line.starts_with(':') {
            continue;
        }
        if let Some(value) = line.strip_prefix("event:") {
            event = Some(value.trim_start().to_string());
        } else if let Some(value) = line.strip_prefix("data:") {
            data.push(value.trim_start());
        }
    }
    if data.is_empty() {
        return Ok(None);
    }
    Ok(Some((event.unwrap_or_default(), data.join("\n"))))
}

fn emit(channel: &Channel<AiStreamEvent>, event: AiStreamEvent) -> Result<(), AiError> {
    channel.send(event).map_err(|_| AiError::cancelled())
}

async fn open_chat_stream(
    state: &AiState,
    key: &SecretString,
    control: &RunControl,
    run_id: &str,
    body: &JsonValue,
    channel: &Channel<AiStreamEvent>,
) -> Result<reqwest::Response, AiError> {
    for attempt in 1..=MAX_ATTEMPTS {
        let response = control
            .wait(
                state
                    .client
                    .post(format!("{COHERE_ORIGIN}/v2/chat"))
                    .header(header::ACCEPT, "text/event-stream")
                    .header("X-Client-Name", CLIENT_NAME)
                    .bearer_auth(key.expose())
                    .json(body)
                    .send(),
            )
            .await?;
        match response {
            Ok(response) => {
                let status = response.status();
                if status.is_success() {
                    let content_type_ok = response
                        .headers()
                        .get(header::CONTENT_TYPE)
                        .and_then(|value| value.to_str().ok())
                        .is_some_and(|value| {
                            value.to_ascii_lowercase().starts_with("text/event-stream")
                        });
                    if !content_type_ok {
                        return Err(AiError::new(
                            AiErrorCode::ProviderProtocol,
                            "Cohere did not return an event stream",
                            false,
                        ));
                    }
                    return Ok(response);
                }
                if is_retryable_status(status) && attempt < MAX_ATTEMPTS {
                    let delay = retry_delay(response.headers(), attempt);
                    drop(response);
                    emit(
                        channel,
                        AiStreamEvent::Retry {
                            run_id: run_id.to_string(),
                            attempt: attempt + 1,
                            retry_after_ms: delay.as_millis().min(u128::from(u64::MAX)) as u64,
                        },
                    )?;
                    cancellable_sleep(control, delay).await?;
                    continue;
                }
                return Err(status_error(status));
            }
            Err(error) => {
                let mapped = network_error(&error);
                if mapped.retryable && attempt < MAX_ATTEMPTS {
                    let delay = retry_delay(&header::HeaderMap::new(), attempt);
                    emit(
                        channel,
                        AiStreamEvent::Retry {
                            run_id: run_id.to_string(),
                            attempt: attempt + 1,
                            retry_after_ms: delay.as_millis().min(u128::from(u64::MAX)) as u64,
                        },
                    )?;
                    cancellable_sleep(control, delay).await?;
                    continue;
                }
                return Err(mapped);
            }
        }
    }
    Err(AiError::internal())
}

async fn consume_chat_stream(
    mut response: reqwest::Response,
    control: &RunControl,
    run_id: &str,
    channel: &Channel<AiStreamEvent>,
) -> Result<(), AiError> {
    let mut decoder = SseDecoder::new();
    let mut sequence = 0u64;
    let mut saw_message_end = false;
    loop {
        let chunk = control
            .wait(response.chunk())
            .await?
            .map_err(|error| network_error(&error))?;
        let Some(chunk) = chunk else { break };
        for (event_name, data) in decoder.push(&chunk)? {
            if event_name == "error" {
                return Err(AiError::new(
                    AiErrorCode::ProviderUnavailable,
                    "Cohere ended the stream with an error",
                    true,
                ));
            }
            let event_type = AiProviderEventType::parse(&event_name).ok_or_else(|| {
                AiError::new(
                    AiErrorCode::ProviderProtocol,
                    "Cohere sent an unknown stream event",
                    false,
                )
            })?;
            let value: JsonValue = serde_json::from_str(&data).map_err(|_| {
                AiError::new(
                    AiErrorCode::ProviderProtocol,
                    "Cohere sent an invalid stream event",
                    false,
                )
            })?;
            if value.get("type").and_then(JsonValue::as_str) != Some(event_type.as_str()) {
                return Err(AiError::new(
                    AiErrorCode::ProviderProtocol,
                    "Cohere stream event type did not match its payload",
                    false,
                ));
            }
            sequence = sequence.saturating_add(1);
            emit(
                channel,
                AiStreamEvent::ProviderEvent {
                    run_id: run_id.to_string(),
                    sequence,
                    event_type,
                    data: value,
                },
            )?;
            if matches!(event_type, AiProviderEventType::MessageEnd) {
                saw_message_end = true;
            }
        }
    }
    decoder.finish()?;
    if !saw_message_end {
        return Err(AiError::new(
            AiErrorCode::ProviderProtocol,
            "Cohere ended the stream before message-end",
            true,
        ));
    }
    Ok(())
}

#[tauri::command]
pub async fn ai_chat_stream(
    state: tauri::State<'_, AiState>,
    request: AiChatRequest,
    on_event: Channel<AiStreamEvent>,
) -> Result<(), AiError> {
    let body = validate_chat_request(&request)?;
    let run_id = request.run_id.clone();
    let state = state.inner().clone();
    let state_for_auth = state.clone();
    let run_id_for_auth = run_id.clone();
    let (key, control, _active_run) = tauri::async_runtime::spawn_blocking(move || {
        state_for_auth.register_authenticated_run(&run_id_for_auth)
    })
    .await
    .map_err(|_| AiError::internal())??;

    let operation = async {
        let response = open_chat_stream(&state, &key, &control, &run_id, &body, &on_event).await?;
        consume_chat_stream(response, &control, &run_id, &on_event).await
    };
    let result = match tokio::time::timeout(CHAT_DEADLINE, operation).await {
        Ok(result) => result,
        Err(_) => Err(AiError::new(
            AiErrorCode::Timeout,
            "The Cohere chat stream exceeded the ten-minute deadline",
            true,
        )),
    };
    match result {
        Ok(()) => {
            let _ = emit(
                &on_event,
                AiStreamEvent::Completed {
                    run_id: run_id.clone(),
                },
            );
        }
        Err(error) if matches!(error.code, AiErrorCode::Cancelled) => {
            let _ = emit(
                &on_event,
                AiStreamEvent::Cancelled {
                    run_id: run_id.clone(),
                },
            );
        }
        Err(error) => {
            let _ = emit(
                &on_event,
                AiStreamEvent::Error {
                    run_id: run_id.clone(),
                    error,
                },
            );
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn ai_embed(
    state: tauri::State<'_, AiState>,
    request: AiEmbedRequest,
) -> Result<AiEmbedResponse, AiError> {
    let body = request.validate_and_build()?;
    let run_id = request.run_id.clone();
    let state = state.inner().clone();
    let state_for_auth = state.clone();
    let run_id_for_auth = run_id.clone();
    let (key, control, _active_run) = tauri::async_runtime::spawn_blocking(move || {
        state_for_auth.register_authenticated_run(&run_id_for_auth)
    })
    .await
    .map_err(|_| AiError::internal())??;
    let bytes = tokio::time::timeout(
        JSON_DEADLINE,
        send_json_with_retry(&state, &key, &control, "/v2/embed", &body),
    )
    .await
    .map_err(|_| AiError::new(AiErrorCode::Timeout, "Cohere Embed timed out", true))??;
    serde_json::from_slice(&bytes).map_err(|_| {
        AiError::new(
            AiErrorCode::ProviderProtocol,
            "Cohere returned an invalid Embed response",
            false,
        )
    })
}

#[tauri::command]
pub async fn ai_rerank(
    state: tauri::State<'_, AiState>,
    request: AiRerankRequest,
) -> Result<AiRerankResponse, AiError> {
    let body = request.validate_and_build()?;
    let run_id = request.run_id.clone();
    let state = state.inner().clone();
    let state_for_auth = state.clone();
    let run_id_for_auth = run_id.clone();
    let (key, control, _active_run) = tauri::async_runtime::spawn_blocking(move || {
        state_for_auth.register_authenticated_run(&run_id_for_auth)
    })
    .await
    .map_err(|_| AiError::internal())??;
    let bytes = tokio::time::timeout(
        JSON_DEADLINE,
        send_json_with_retry(&state, &key, &control, "/v2/rerank", &body),
    )
    .await
    .map_err(|_| AiError::new(AiErrorCode::Timeout, "Cohere Rerank timed out", true))??;
    serde_json::from_slice(&bytes).map_err(|_| {
        AiError::new(
            AiErrorCode::ProviderProtocol,
            "Cohere returned an invalid Rerank response",
            false,
        )
    })
}

// ---------------------------------------------------------------------------
// Local, content-addressed AI attachments and PDF source extraction
// ---------------------------------------------------------------------------

// Upload/extraction follows a narrow allowlist, byte signatures, generated
// names and both compressed + expanded limits. Office Open XML is ZIP + XML,
// but no relationship is fetched and no macro/formula/code is executed.
// References:
// https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html
// https://learn.microsoft.com/en-us/office/open-xml/getting-started

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AiAttachmentKind {
    Pdf,
    Png,
    Jpeg,
    Webp,
    Gif,
    Text,
    Docx,
    Xlsx,
    Pptx,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AttachmentFormat {
    Pdf,
    Png,
    Jpeg,
    Webp,
    Gif,
    Text,
    Docx,
    Xlsx,
    Pptx,
}

impl AttachmentFormat {
    fn extension(self) -> &'static str {
        match self {
            Self::Pdf => "pdf",
            Self::Png => "png",
            Self::Jpeg => "jpg",
            Self::Webp => "webp",
            Self::Gif => "gif",
            Self::Text => "txt",
            Self::Docx => "docx",
            Self::Xlsx => "xlsx",
            Self::Pptx => "pptx",
        }
    }

    fn mime_type(self) -> &'static str {
        match self {
            Self::Pdf => "application/pdf",
            Self::Png => "image/png",
            Self::Jpeg => "image/jpeg",
            Self::Webp => "image/webp",
            Self::Gif => "image/gif",
            Self::Text => "text/plain",
            Self::Docx => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            Self::Xlsx => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            Self::Pptx => {
                "application/vnd.openxmlformats-officedocument.presentationml.presentation"
            }
        }
    }

    fn kind(self) -> AiAttachmentKind {
        match self {
            Self::Pdf => AiAttachmentKind::Pdf,
            Self::Png => AiAttachmentKind::Png,
            Self::Jpeg => AiAttachmentKind::Jpeg,
            Self::Webp => AiAttachmentKind::Webp,
            Self::Gif => AiAttachmentKind::Gif,
            Self::Text => AiAttachmentKind::Text,
            Self::Docx => AiAttachmentKind::Docx,
            Self::Xlsx => AiAttachmentKind::Xlsx,
            Self::Pptx => AiAttachmentKind::Pptx,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAttachmentSaveRequest {
    bytes: Vec<u8>,
    #[serde(default)]
    namespace: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAttachmentMetadata {
    pub id: String,
    pub kind: AiAttachmentKind,
    pub mime_type: String,
    pub size_bytes: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAttachmentData {
    pub metadata: AiAttachmentMetadata,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAttachmentDeleteResult {
    pub id: String,
    pub deleted: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiExtractedDocumentSource {
    pub attachment_id: String,
    pub sha256: String,
    pub media_type: String,
    pub text: String,
    pub text_bytes: usize,
    pub truncated: bool,
    pub unit_labels: Vec<String>,
    pub extraction_warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiPdfSource {
    pub attachment_id: String,
    pub sha256: String,
    pub page_count: usize,
    pub total_text_bytes: usize,
    pub truncated: bool,
    pub pages: Vec<AiPdfSourcePage>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiPdfSourcePage {
    pub page_number: u32,
    pub text: String,
    pub text_bytes: usize,
    pub truncated: bool,
    pub extraction_failed: bool,
    pub needs_ocr: bool,
    pub needs_visual_review: bool,
    pub has_embedded_images: bool,
    /// Vector paths, shadings, inline images, or Form XObjects that cannot be
    /// represented by the extracted embedded-image evidence.
    pub has_vector_graphics: bool,
    pub visual_evidence: AiPdfVisualEvidence,
    pub unresolved_visual_count: usize,
    pub visuals: Vec<AiPdfVisual>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // Reserved for a future verified full-page raster pipeline.
pub enum AiPdfVisualEvidence {
    NotNeeded,
    Available,
    Unresolved,
}

/// A content-addressed, locally managed visual extracted from a PDF page.
///
/// This is deliberately not called a page render: with Alcove's current pure
/// Rust PDF dependencies we can safely preserve byte-valid JPEG XObjects, but
/// cannot claim to have rasterized arbitrary vector content or page layout.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiPdfVisual {
    pub attachment_id: String,
    pub mime_type: String,
    pub sha256: String,
    pub width: u32,
    pub height: u32,
}

fn attachment_root(paths: &LibraryPaths) -> PathBuf {
    paths.root().join("ai").join("attachments")
}

fn validate_attachment_id(id: &str) -> Result<AttachmentFormat, AiError> {
    let (stem, extension) = id
        .rsplit_once('.')
        .ok_or_else(|| AiError::invalid("attachmentId is not valid"))?;
    let digest = stem
        .strip_prefix("att_")
        .or_else(|| stem.strip_prefix("preview_"))
        .ok_or_else(|| AiError::invalid("attachmentId is not valid"))?;
    if digest.len() != 64
        || !digest
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
    {
        return Err(AiError::invalid("attachmentId is not valid"));
    }
    match extension {
        "pdf" => Ok(AttachmentFormat::Pdf),
        "png" => Ok(AttachmentFormat::Png),
        "jpg" => Ok(AttachmentFormat::Jpeg),
        "webp" => Ok(AttachmentFormat::Webp),
        "gif" => Ok(AttachmentFormat::Gif),
        "txt" => Ok(AttachmentFormat::Text),
        "docx" => Ok(AttachmentFormat::Docx),
        "xlsx" => Ok(AttachmentFormat::Xlsx),
        "pptx" => Ok(AttachmentFormat::Pptx),
        _ => Err(AiError::invalid("attachmentId is not valid")),
    }
}

fn attachment_path(paths: &LibraryPaths, id: &str) -> Result<(PathBuf, AttachmentFormat), AiError> {
    let format = validate_attachment_id(id)?;
    Ok((attachment_root(paths).join(id), format))
}

fn sniff_attachment(bytes: &[u8]) -> Result<AttachmentFormat, AiError> {
    if bytes.starts_with(b"%PDF-") {
        return Ok(AttachmentFormat::Pdf);
    }
    if bytes.len() >= 33
        && bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a])
        && &bytes[12..16] == b"IHDR"
        && u32::from_be_bytes(bytes[8..12].try_into().unwrap_or_default()) == 13
        && u32::from_be_bytes(bytes[16..20].try_into().unwrap_or_default()) > 0
        && u32::from_be_bytes(bytes[20..24].try_into().unwrap_or_default()) > 0
    {
        return Ok(AttachmentFormat::Png);
    }
    if bytes.len() >= 4 && bytes.starts_with(&[0xff, 0xd8, 0xff]) && bytes.ends_with(&[0xff, 0xd9])
    {
        return Ok(AttachmentFormat::Jpeg);
    }
    if bytes.len() >= 16
        && &bytes[..4] == b"RIFF"
        && &bytes[8..12] == b"WEBP"
        && u32::from_le_bytes(bytes[4..8].try_into().unwrap_or_default()) as usize + 8
            <= bytes.len()
    {
        return Ok(AttachmentFormat::Webp);
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        validate_static_gif(bytes)?;
        return Ok(AttachmentFormat::Gif);
    }
    if let Ok(format) = sniff_open_xml(bytes) {
        return Ok(format);
    }
    if valid_text_attachment(bytes) {
        return Ok(AttachmentFormat::Text);
    }
    Err(AiError::new(
        AiErrorCode::AttachmentInvalid,
        "Only valid PDF, image, UTF-8 text/code/data, DOCX, XLSX, or PPTX attachments are supported",
        false,
    ))
}

fn valid_text_attachment(bytes: &[u8]) -> bool {
    if bytes.is_empty()
        || bytes.len() > MAX_TEXT_ATTACHMENT_BYTES
        || bytes.iter().any(|byte| *byte == 0)
    {
        return false;
    }
    let text = match std::str::from_utf8(bytes) {
        Ok(value) => value,
        Err(_) => return false,
    };
    let disallowed = text
        .chars()
        .filter(|character| {
            character.is_control() && !matches!(character, '\n' | '\r' | '\t' | '\u{000c}')
        })
        .count();
    disallowed.saturating_mul(1000) <= text.chars().count().max(1)
}

fn bounded_open_xml_archive(bytes: &[u8]) -> Result<zip::ZipArchive<Cursor<&[u8]>>, AiError> {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| {
        AiError::new(
            AiErrorCode::AttachmentInvalid,
            "The Office document is not a valid Open XML package",
            false,
        )
    })?;
    if archive.len() == 0 || archive.len() > MAX_OFFICE_ARCHIVE_ENTRIES {
        return Err(AiError::new(
            AiErrorCode::AttachmentInvalid,
            "The Office document contains too many package entries",
            false,
        ));
    }
    let mut expanded = 0_u64;
    for index in 0..archive.len() {
        let entry = archive.by_index(index).map_err(|_| {
            AiError::new(
                AiErrorCode::AttachmentInvalid,
                "The Office package directory is invalid",
                false,
            )
        })?;
        if entry.encrypted()
            || entry.enclosed_name().is_none()
            || entry.size() > MAX_OFFICE_ENTRY_BYTES
        {
            return Err(AiError::new(
                AiErrorCode::AttachmentInvalid,
                "The Office document contains an unsafe package entry",
                false,
            ));
        }
        expanded = expanded.checked_add(entry.size()).ok_or_else(|| {
            AiError::new(
                AiErrorCode::AttachmentInvalid,
                "The Office document expands beyond its safe limit",
                false,
            )
        })?;
        if expanded > MAX_OFFICE_ARCHIVE_EXPANDED_BYTES {
            return Err(AiError::new(
                AiErrorCode::AttachmentInvalid,
                "The Office document expands beyond its safe limit",
                false,
            ));
        }
    }
    Ok(archive)
}

fn archive_has(archive: &mut zip::ZipArchive<Cursor<&[u8]>>, name: &str) -> bool {
    archive.by_name(name).is_ok()
}

fn sniff_open_xml(bytes: &[u8]) -> Result<AttachmentFormat, AiError> {
    if !bytes.starts_with(b"PK\x03\x04") {
        return Err(AiError::invalid("not an Open XML package"));
    }
    let mut archive = bounded_open_xml_archive(bytes)?;
    if archive_has(&mut archive, "word/document.xml") {
        if archive
            .file_names()
            .any(|name| name.ends_with("vbaProject.bin"))
        {
            return Err(AiError::new(
                AiErrorCode::AttachmentInvalid,
                "Macro-enabled Office documents are not supported",
                false,
            ));
        }
        return Ok(AttachmentFormat::Docx);
    }
    if archive_has(&mut archive, "xl/workbook.xml") {
        if archive
            .file_names()
            .any(|name| name.ends_with("vbaProject.bin") || name.starts_with("xl/externalLinks/"))
        {
            return Err(AiError::new(
                AiErrorCode::AttachmentInvalid,
                "Macro-enabled or externally linked spreadsheets are not supported",
                false,
            ));
        }
        return Ok(AttachmentFormat::Xlsx);
    }
    if archive_has(&mut archive, "ppt/presentation.xml") {
        if archive
            .file_names()
            .any(|name| name.ends_with("vbaProject.bin"))
        {
            return Err(AiError::new(
                AiErrorCode::AttachmentInvalid,
                "Macro-enabled presentations are not supported",
                false,
            ));
        }
        return Ok(AttachmentFormat::Pptx);
    }
    Err(AiError::new(
        AiErrorCode::AttachmentInvalid,
        "Only DOCX, XLSX, and PPTX Open XML packages are supported",
        false,
    ))
}

fn read_zip_entry(
    archive: &mut zip::ZipArchive<Cursor<&[u8]>>,
    name: &str,
) -> Result<Option<Vec<u8>>, AiError> {
    let entry = match archive.by_name(name) {
        Ok(entry) => entry,
        Err(zip::result::ZipError::FileNotFound) => return Ok(None),
        Err(_) => {
            return Err(AiError::new(
                AiErrorCode::AttachmentInvalid,
                "The Office package entry is invalid",
                false,
            ))
        }
    };
    if entry.encrypted() || entry.size() > MAX_OFFICE_ENTRY_BYTES {
        return Err(AiError::new(
            AiErrorCode::AttachmentInvalid,
            "The Office package entry exceeds its safe limit",
            false,
        ));
    }
    let mut bytes = Vec::with_capacity(entry.size() as usize);
    entry
        .take(MAX_OFFICE_ENTRY_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| {
            AiError::new(
                AiErrorCode::AttachmentInvalid,
                "The Office package entry could not be read safely",
                false,
            )
        })?;
    if bytes.len() as u64 > MAX_OFFICE_ENTRY_BYTES {
        return Err(AiError::new(
            AiErrorCode::AttachmentInvalid,
            "The Office package entry exceeds its safe limit",
            false,
        ));
    }
    Ok(Some(bytes))
}

fn decode_xml_reference(reference: &quick_xml::events::BytesRef<'_>) -> Result<String, AiError> {
    let decoded = reference.decode().map_err(|_| {
        AiError::new(
            AiErrorCode::AttachmentInvalid,
            "The Office XML entity encoding is invalid",
            false,
        )
    })?;
    let value = match decoded.as_ref() {
        "amp" => "&".to_string(),
        "lt" => "<".to_string(),
        "gt" => ">".to_string(),
        "apos" => "'".to_string(),
        "quot" => "\"".to_string(),
        numeric if numeric.starts_with("#x") => u32::from_str_radix(&numeric[2..], 16)
            .ok()
            .and_then(char::from_u32)
            .map(|character| character.to_string())
            .ok_or_else(|| {
                AiError::new(
                    AiErrorCode::AttachmentInvalid,
                    "The Office XML numeric entity is invalid",
                    false,
                )
            })?,
        numeric if numeric.starts_with('#') => numeric[1..]
            .parse::<u32>()
            .ok()
            .and_then(char::from_u32)
            .map(|character| character.to_string())
            .ok_or_else(|| {
                AiError::new(
                    AiErrorCode::AttachmentInvalid,
                    "The Office XML numeric entity is invalid",
                    false,
                )
            })?,
        _ => {
            return Err(AiError::new(
                AiErrorCode::AttachmentInvalid,
                "Custom Office XML entities are not supported",
                false,
            ))
        }
    };
    Ok(value)
}

fn xml_text(bytes: &[u8], breaks: &[&[u8]]) -> Result<String, AiError> {
    let mut reader = XmlReader::from_reader(bytes);
    reader.config_mut().trim_text(false);
    reader.config_mut().check_end_names = true;
    reader.config_mut().allow_unmatched_ends = false;
    let mut output = String::new();
    loop {
        match reader.read_event() {
            Ok(XmlEvent::Text(text)) => {
                let decoded = text.decode().map_err(|_| {
                    AiError::new(
                        AiErrorCode::AttachmentInvalid,
                        "The Office XML text encoding is invalid",
                        false,
                    )
                })?;
                let unescaped = quick_xml::escape::unescape(&decoded).map_err(|_| {
                    AiError::new(
                        AiErrorCode::AttachmentInvalid,
                        "The Office XML text is invalid",
                        false,
                    )
                })?;
                output.push_str(&unescaped);
            }
            Ok(XmlEvent::GeneralRef(reference)) => {
                output.push_str(&decode_xml_reference(&reference)?)
            }
            Ok(XmlEvent::Start(start)) | Ok(XmlEvent::Empty(start)) => {
                if breaks
                    .iter()
                    .any(|name| start.local_name().as_ref() == *name)
                    && !output.ends_with('\n')
                {
                    output.push('\n');
                }
            }
            Ok(XmlEvent::End(end)) => {
                if breaks.iter().any(|name| end.local_name().as_ref() == *name)
                    && !output.ends_with('\n')
                {
                    output.push('\n');
                }
            }
            Ok(XmlEvent::DocType(_)) => {
                return Err(AiError::new(
                    AiErrorCode::AttachmentInvalid,
                    "Office documents with a document type declaration are not supported",
                    false,
                ))
            }
            Ok(XmlEvent::Eof) => break,
            Ok(_) => {}
            Err(_) => {
                return Err(AiError::new(
                    AiErrorCode::AttachmentInvalid,
                    "The Office XML is malformed",
                    false,
                ))
            }
        }
        // Each XML entry is already bounded. Keep the full entry here so the
        // document-level cap can report truncation truthfully and trim only at
        // a UTF-8 boundary.
    }
    Ok(output
        .lines()
        .map(str::trim_end)
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string())
}

fn extract_docx_text(bytes: &[u8]) -> Result<(String, Vec<String>, Vec<String>), AiError> {
    let mut archive = bounded_open_xml_archive(bytes)?;
    let mut sections = Vec::new();
    let mut labels = Vec::new();
    let document = read_zip_entry(&mut archive, "word/document.xml")?.ok_or_else(|| {
        AiError::new(
            AiErrorCode::AttachmentInvalid,
            "The DOCX document body is missing",
            false,
        )
    })?;
    sections.push(format!(
        "## Document body\n{}",
        xml_text(&document, &[b"p", b"br", b"tab", b"tr"])?
    ));
    labels.push("document body".to_string());
    if let Some(value) = read_zip_entry(&mut archive, "word/footnotes.xml")? {
        sections.push(format!(
            "## Footnotes\n{}",
            xml_text(&value, &[b"p", b"br", b"tab"])?
        ));
        labels.push("footnotes".to_string());
    }
    if let Some(value) = read_zip_entry(&mut archive, "word/endnotes.xml")? {
        sections.push(format!(
            "## Endnotes\n{}",
            xml_text(&value, &[b"p", b"br", b"tab"])?
        ));
        labels.push("endnotes".to_string());
    }
    for prefix in ["header", "footer"] {
        for index in 1..=128 {
            let name = format!("word/{prefix}{index}.xml");
            let Some(value) = read_zip_entry(&mut archive, &name)? else {
                continue;
            };
            let label = format!("{prefix} {index}");
            sections.push(format!(
                "## {}\n{}",
                label,
                xml_text(&value, &[b"p", b"br", b"tab"])?
            ));
            labels.push(label);
        }
    }
    Ok((sections.into_iter().filter(|item| !item.is_empty()).collect::<Vec<_>>().join("\n\n"), labels, vec![
        "Embedded media, drawing geometry, comments, revision history, and page layout are not represented by text extraction; body, headers, footers, footnotes, and endnotes are extracted when present.".to_string(),
    ]))
}

fn shared_strings(bytes: Option<Vec<u8>>) -> Result<Vec<String>, AiError> {
    let Some(bytes) = bytes else {
        return Ok(Vec::new());
    };
    let mut reader = XmlReader::from_reader(bytes.as_slice());
    reader.config_mut().trim_text(false);
    let mut values = Vec::new();
    let mut current = String::new();
    let mut inside_item = false;
    loop {
        match reader.read_event() {
            Ok(XmlEvent::Start(start)) if start.local_name().as_ref() == b"si" => {
                current.clear();
                inside_item = true;
            }
            Ok(XmlEvent::End(end)) if end.local_name().as_ref() == b"si" => {
                values.push(current.clone());
                inside_item = false;
            }
            Ok(XmlEvent::Text(text)) if inside_item => {
                let decoded = text.decode().map_err(|_| {
                    AiError::new(
                        AiErrorCode::AttachmentInvalid,
                        "The spreadsheet text encoding is invalid",
                        false,
                    )
                })?;
                let unescaped = quick_xml::escape::unescape(&decoded).map_err(|_| {
                    AiError::new(
                        AiErrorCode::AttachmentInvalid,
                        "The spreadsheet text is invalid",
                        false,
                    )
                })?;
                current.push_str(&unescaped);
            }
            Ok(XmlEvent::GeneralRef(reference)) if inside_item => {
                current.push_str(&decode_xml_reference(&reference)?);
            }
            Ok(XmlEvent::DocType(_)) => {
                return Err(AiError::new(
                    AiErrorCode::AttachmentInvalid,
                    "Spreadsheet document types are not supported",
                    false,
                ))
            }
            Ok(XmlEvent::Eof) => break,
            Ok(_) => {}
            Err(_) => {
                return Err(AiError::new(
                    AiErrorCode::AttachmentInvalid,
                    "The spreadsheet XML is malformed",
                    false,
                ))
            }
        }
        if values.len() > 1_000_000 || current.len() > MAX_EXTRACTED_DOCUMENT_BYTES {
            return Err(AiError::new(
                AiErrorCode::AttachmentInvalid,
                "The spreadsheet text exceeds its safe limit",
                false,
            ));
        }
    }
    Ok(values)
}

fn extract_sheet_text(bytes: &[u8], strings: &[String]) -> Result<String, AiError> {
    let mut reader = XmlReader::from_reader(bytes);
    reader.config_mut().trim_text(false);
    let mut output = String::new();
    let mut cell_type = String::new();
    let mut cell_ref = String::new();
    let mut cell_value = String::new();
    let mut cell_formula = String::new();
    let mut in_value = false;
    let mut in_inline_text = false;
    let mut in_formula = false;
    loop {
        match reader.read_event() {
            Ok(XmlEvent::Start(start)) if start.local_name().as_ref() == b"c" => {
                cell_type = start
                    .attributes()
                    .flatten()
                    .find_map(|attribute| {
                        (attribute.key.local_name().as_ref() == b"t")
                            .then(|| String::from_utf8_lossy(attribute.value.as_ref()).to_string())
                    })
                    .unwrap_or_default();
                cell_ref = start
                    .attributes()
                    .flatten()
                    .find_map(|attribute| {
                        (attribute.key.local_name().as_ref() == b"r")
                            .then(|| String::from_utf8_lossy(attribute.value.as_ref()).to_string())
                    })
                    .unwrap_or_default();
                cell_value.clear();
                cell_formula.clear();
            }
            Ok(XmlEvent::Start(start)) if start.local_name().as_ref() == b"v" => in_value = true,
            Ok(XmlEvent::End(end)) if end.local_name().as_ref() == b"v" => in_value = false,
            Ok(XmlEvent::Start(start)) if start.local_name().as_ref() == b"t" => {
                in_inline_text = true
            }
            Ok(XmlEvent::End(end)) if end.local_name().as_ref() == b"t" => in_inline_text = false,
            Ok(XmlEvent::Start(start)) if start.local_name().as_ref() == b"f" => in_formula = true,
            Ok(XmlEvent::End(end)) if end.local_name().as_ref() == b"f" => in_formula = false,
            Ok(XmlEvent::Text(text)) if in_value || in_inline_text || in_formula => {
                let decoded = text.decode().map_err(|_| {
                    AiError::new(
                        AiErrorCode::AttachmentInvalid,
                        "The spreadsheet cell encoding is invalid",
                        false,
                    )
                })?;
                let unescaped = quick_xml::escape::unescape(&decoded).map_err(|_| {
                    AiError::new(
                        AiErrorCode::AttachmentInvalid,
                        "The spreadsheet cell is invalid",
                        false,
                    )
                })?;
                if in_formula {
                    cell_formula.push_str(&unescaped);
                } else {
                    cell_value.push_str(&unescaped);
                }
            }
            Ok(XmlEvent::GeneralRef(reference)) if in_value || in_inline_text || in_formula => {
                let decoded = decode_xml_reference(&reference)?;
                if in_formula {
                    cell_formula.push_str(&decoded);
                } else {
                    cell_value.push_str(&decoded);
                }
            }
            Ok(XmlEvent::End(end)) if end.local_name().as_ref() == b"c" => {
                let rendered = if cell_type == "s" {
                    cell_value
                        .parse::<usize>()
                        .ok()
                        .and_then(|index| strings.get(index))
                        .cloned()
                        .unwrap_or_else(|| "[missing shared string]".to_string())
                } else {
                    cell_value.clone()
                };
                if !output.ends_with('\n') && !output.is_empty() {
                    output.push('\t');
                }
                if !cell_ref.is_empty() {
                    output.push_str(&cell_ref);
                    output.push('=');
                }
                if !cell_formula.is_empty() {
                    output.push('=');
                    output.push_str(&cell_formula);
                    output.push_str(" → ");
                }
                output.push_str(&rendered);
            }
            Ok(XmlEvent::End(end)) if end.local_name().as_ref() == b"row" => output.push('\n'),
            Ok(XmlEvent::DocType(_)) => {
                return Err(AiError::new(
                    AiErrorCode::AttachmentInvalid,
                    "Spreadsheet document types are not supported",
                    false,
                ))
            }
            Ok(XmlEvent::Eof) => break,
            Ok(_) => {}
            Err(_) => {
                return Err(AiError::new(
                    AiErrorCode::AttachmentInvalid,
                    "The spreadsheet XML is malformed",
                    false,
                ))
            }
        }
        // The archive and individual entry caps bound this string. Final
        // document truncation is centralized in `extract_document_source`.
    }
    Ok(output.trim().to_string())
}

fn extract_xlsx_text(bytes: &[u8]) -> Result<(String, Vec<String>, Vec<String>), AiError> {
    let mut archive = bounded_open_xml_archive(bytes)?;
    let strings = shared_strings(read_zip_entry(&mut archive, "xl/sharedStrings.xml")?)?;
    let names = numbered_open_xml_parts(&archive, "xl/worksheets/sheet");
    let mut sections = Vec::new();
    let mut labels = Vec::new();
    for (index, name) in names.iter().enumerate() {
        let Some(sheet) = read_zip_entry(&mut archive, name)? else {
            continue;
        };
        let text = extract_sheet_text(&sheet, &strings)?;
        if text.is_empty() {
            continue;
        }
        let number = open_xml_part_number(name, "xl/worksheets/sheet").unwrap_or(index + 1);
        labels.push(format!("sheet {number}"));
        sections.push(format!("## Sheet {number}\n{text}"));
    }
    Ok((sections.join("\n\n"), labels, vec![
        "Cell formulas are preserved but never evaluated; cached values are extracted beside them. Charts, drawings, comments, formatting, and hidden state are not represented; macros are rejected.".to_string(),
    ]))
}

fn numbered_open_xml_parts(archive: &zip::ZipArchive<Cursor<&[u8]>>, prefix: &str) -> Vec<String> {
    let mut names = archive
        .file_names()
        .filter(|name| name.starts_with(prefix) && name.ends_with(".xml"))
        .map(str::to_string)
        .collect::<Vec<_>>();
    names.sort_by_key(|name| open_xml_part_number(name, prefix).unwrap_or(usize::MAX));
    names
}

fn open_xml_part_number(name: &str, prefix: &str) -> Option<usize> {
    name.strip_prefix(prefix)
        .and_then(|tail| tail.strip_suffix(".xml"))
        .and_then(|number| number.parse::<usize>().ok())
}

fn extract_pptx_text(bytes: &[u8]) -> Result<(String, Vec<String>, Vec<String>), AiError> {
    let mut archive = bounded_open_xml_archive(bytes)?;
    let slide_names = numbered_open_xml_parts(&archive, "ppt/slides/slide");
    let note_names = numbered_open_xml_parts(&archive, "ppt/notesSlides/notesSlide");
    let mut sections = Vec::new();
    let mut labels = Vec::new();
    for (index, name) in slide_names.iter().enumerate() {
        let Some(slide) = read_zip_entry(&mut archive, name)? else {
            continue;
        };
        let text = xml_text(&slide, &[b"p", b"br", b"tab"])?;
        if text.is_empty() {
            continue;
        }
        let number = open_xml_part_number(name, "ppt/slides/slide").unwrap_or(index + 1);
        let label = format!("slide {number}");
        labels.push(label.clone());
        sections.push(format!("## {}\n{}", label, text));
    }
    for (index, name) in note_names.iter().enumerate() {
        let Some(notes) = read_zip_entry(&mut archive, name)? else {
            continue;
        };
        let text = xml_text(&notes, &[b"p", b"br", b"tab"])?;
        if text.is_empty() {
            continue;
        }
        let number = open_xml_part_number(name, "ppt/notesSlides/notesSlide").unwrap_or(index + 1);
        let label = format!("speaker notes {number}");
        labels.push(label.clone());
        sections.push(format!("## {}\n{}", label, text));
    }
    Ok((sections.join("\n\n"), labels, vec![
        "Slide and speaker-note text are extracted in order. Images, charts, diagrams, animations, layout, and theme styling are not represented; macros are rejected.".to_string(),
    ]))
}

fn extract_document_source(data: AiAttachmentData) -> Result<AiExtractedDocumentSource, AiError> {
    let (mut text, labels, warnings) = match data.metadata.kind {
        AiAttachmentKind::Text => (
            String::from_utf8(data.bytes.clone()).map_err(|_| {
                AiError::new(
                    AiErrorCode::AttachmentInvalid,
                    "The text attachment is not UTF-8",
                    false,
                )
            })?,
            vec!["text".to_string()],
            Vec::new(),
        ),
        AiAttachmentKind::Docx => extract_docx_text(&data.bytes)?,
        AiAttachmentKind::Xlsx => extract_xlsx_text(&data.bytes)?,
        AiAttachmentKind::Pptx => extract_pptx_text(&data.bytes)?,
        _ => {
            return Err(AiError::new(
                AiErrorCode::AttachmentInvalid,
                "That attachment has no document-text extractor",
                false,
            ))
        }
    };
    let truncated = truncate_utf8(&mut text, MAX_EXTRACTED_DOCUMENT_BYTES);
    Ok(AiExtractedDocumentSource {
        attachment_id: data.metadata.id,
        sha256: data.metadata.sha256,
        media_type: data.metadata.mime_type,
        text_bytes: text.len(),
        text,
        truncated,
        unit_labels: labels,
        extraction_warnings: warnings,
    })
}

fn validate_static_gif(bytes: &[u8]) -> Result<(), AiError> {
    let limit = NonZeroU64::new(MAX_ATTACHMENT_BYTES as u64).ok_or_else(AiError::internal)?;
    let mut options = gif::DecodeOptions::new();
    options.set_memory_limit(gif::MemoryLimit::Bytes(limit));
    options.set_color_output(gif::ColorOutput::Indexed);
    options.skip_frame_decoding(true);
    options.check_frame_consistency(true);
    let mut decoder = options.read_info(Cursor::new(bytes)).map_err(|_| {
        AiError::new(
            AiErrorCode::AttachmentInvalid,
            "The GIF attachment is malformed",
            false,
        )
    })?;
    if decoder
        .read_next_frame()
        .map_err(|_| {
            AiError::new(
                AiErrorCode::AttachmentInvalid,
                "The GIF attachment is malformed",
                false,
            )
        })?
        .is_none()
    {
        return Err(AiError::new(
            AiErrorCode::AttachmentInvalid,
            "The GIF attachment contains no image frame",
            false,
        ));
    }
    if decoder
        .read_next_frame()
        .map_err(|_| {
            AiError::new(
                AiErrorCode::AttachmentInvalid,
                "The GIF attachment is malformed",
                false,
            )
        })?
        .is_some()
    {
        return Err(AiError::new(
            AiErrorCode::AttachmentInvalid,
            "Animated GIF attachments are not supported",
            false,
        ));
    }
    Ok(())
}

fn validate_image_data_uri(raw: &str) -> Result<usize, AiError> {
    let (format, encoded) = if let Some(encoded) = raw.strip_prefix("data:image/png;base64,") {
        (AttachmentFormat::Png, encoded)
    } else if let Some(encoded) = raw.strip_prefix("data:image/jpeg;base64,") {
        (AttachmentFormat::Jpeg, encoded)
    } else if let Some(encoded) = raw.strip_prefix("data:image/webp;base64,") {
        (AttachmentFormat::Webp, encoded)
    } else if let Some(encoded) = raw.strip_prefix("data:image/gif;base64,") {
        (AttachmentFormat::Gif, encoded)
    } else {
        return Err(AiError::invalid(
            "Image URLs must be local PNG, JPEG, WebP, or GIF base64 data URIs",
        ));
    };
    if encoded.is_empty() || encoded.len() > (MAX_IMAGE_BYTES * 4 / 3 + 16) {
        return Err(AiError::invalid("Image data URI exceeds the 20 MB cap"));
    }
    let bytes = BASE64
        .decode(encoded)
        .map_err(|_| AiError::invalid("Image data URI contains invalid base64"))?;
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err(AiError::invalid("Image data URI exceeds the 20 MB cap"));
    }
    let detected = sniff_attachment(&bytes)?;
    if detected != format {
        return Err(AiError::invalid(
            "Image data URI MIME type does not match its bytes",
        ));
    }
    Ok(bytes.len())
}

fn metadata_for(id: String, format: AttachmentFormat, size: u64) -> AiAttachmentMetadata {
    let digest = id
        .strip_prefix("att_")
        .or_else(|| id.strip_prefix("preview_"))
        .and_then(|value| value.split_once('.').map(|(digest, _)| digest))
        .unwrap_or_default()
        .to_string();
    AiAttachmentMetadata {
        id,
        kind: format.kind(),
        mime_type: format.mime_type().to_string(),
        size_bytes: size,
        sha256: digest,
    }
}

fn store_attachment_bytes(
    paths: &LibraryPaths,
    bytes: &[u8],
) -> Result<AiAttachmentMetadata, AiError> {
    store_attachment_bytes_in_namespace(paths, bytes, "att")
}

fn store_attachment_bytes_in_namespace(
    paths: &LibraryPaths,
    bytes: &[u8],
    namespace: &str,
) -> Result<AiAttachmentMetadata, AiError> {
    if bytes.is_empty() || bytes.len() > MAX_ATTACHMENT_BYTES {
        return Err(AiError::invalid(
            "AI attachments must be between 1 byte and 32 MB",
        ));
    }
    let format = sniff_attachment(bytes)?;
    let digest = format!("{:x}", Sha256::digest(bytes));
    let prefix = match namespace {
        "att" => "att",
        "preview" => "preview",
        _ => return Err(AiError::invalid("attachment namespace is not valid")),
    };
    let id = format!("{prefix}_{digest}.{}", format.extension());
    let root = attachment_root(paths);
    std::fs::create_dir_all(&root).map_err(|_| AiError::internal())?;
    let target = root.join(&id);
    if !target.exists() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let counter = ATTACHMENT_TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
        let temp = root.join(format!(
            ".write-{}-{nonce}-{counter}.tmp",
            std::process::id()
        ));
        let write_result = (|| -> Result<(), AiError> {
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temp)
                .map_err(|_| AiError::internal())?;
            file.write_all(bytes).map_err(|_| AiError::internal())?;
            file.sync_all().map_err(|_| AiError::internal())?;
            match std::fs::rename(&temp, &target) {
                Ok(()) => Ok(()),
                Err(_) if target.is_file() => Ok(()),
                Err(_) => Err(AiError::internal()),
            }
        })();
        let _ = std::fs::remove_file(&temp);
        write_result?;
    }
    let stored = read_attachment(paths, &id)?;
    if stored.bytes.len() != bytes.len() {
        return Err(AiError::new(
            AiErrorCode::AttachmentInvalid,
            "A conflicting attachment already exists",
            false,
        ));
    }
    Ok(stored.metadata)
}

fn read_attachment(paths: &LibraryPaths, id: &str) -> Result<AiAttachmentData, AiError> {
    let (path, format) = attachment_path(paths, id)?;
    let metadata = std::fs::symlink_metadata(&path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            AiError::new(
                AiErrorCode::AttachmentNotFound,
                "That AI attachment no longer exists",
                false,
            )
        } else {
            AiError::internal()
        }
    })?;
    if metadata.file_type().is_symlink()
        || !metadata.is_file()
        || metadata.len() == 0
        || metadata.len() > MAX_ATTACHMENT_BYTES as u64
    {
        return Err(AiError::new(
            AiErrorCode::AttachmentInvalid,
            "The stored AI attachment is invalid or too large",
            false,
        ));
    }
    let bytes = std::fs::read(&path).map_err(|_| AiError::internal())?;
    if sniff_attachment(&bytes)? != format {
        return Err(AiError::new(
            AiErrorCode::AttachmentInvalid,
            "The stored AI attachment does not match its recorded format",
            false,
        ));
    }
    let digest = format!("{:x}", Sha256::digest(&bytes));
    let expected = id
        .strip_prefix("att_")
        .or_else(|| id.strip_prefix("preview_"))
        .and_then(|value| value.split_once('.').map(|(digest, _)| digest))
        .unwrap_or_default();
    if digest != expected {
        return Err(AiError::new(
            AiErrorCode::AttachmentInvalid,
            "The stored AI attachment failed its integrity check",
            false,
        ));
    }
    Ok(AiAttachmentData {
        metadata: metadata_for(id.to_string(), format, metadata.len()),
        bytes,
    })
}

#[tauri::command]
pub async fn ai_attachment_save(
    paths: tauri::State<'_, LibraryPaths>,
    request: AiAttachmentSaveRequest,
) -> Result<AiAttachmentMetadata, AiError> {
    if request.bytes.is_empty() || request.bytes.len() > MAX_ATTACHMENT_BYTES {
        return Err(AiError::invalid(
            "AI attachments must be between 1 byte and 32 MB",
        ));
    }
    let paths = paths.inner().clone();
    let namespace = request.namespace.unwrap_or_else(|| "att".to_string());
    tauri::async_runtime::spawn_blocking(move || {
        store_attachment_bytes_in_namespace(&paths, &request.bytes, &namespace)
    })
    .await
    .map_err(|_| AiError::internal())?
}

#[tauri::command]
pub async fn ai_attachment_read(
    paths: tauri::State<'_, LibraryPaths>,
    attachment_id: String,
) -> Result<AiAttachmentData, AiError> {
    let paths = paths.inner().clone();
    tauri::async_runtime::spawn_blocking(move || read_attachment(&paths, &attachment_id))
        .await
        .map_err(|_| AiError::internal())?
}

#[tauri::command]
pub async fn ai_attachment_delete(
    paths: tauri::State<'_, LibraryPaths>,
    attachment_id: String,
) -> Result<AiAttachmentDeleteResult, AiError> {
    let paths = paths.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (path, _) = attachment_path(&paths, &attachment_id)?;
        let deleted = match std::fs::remove_file(&path) {
            Ok(()) => true,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
            Err(_) => return Err(AiError::internal()),
        };
        Ok(AiAttachmentDeleteResult {
            id: attachment_id,
            deleted,
        })
    })
    .await
    .map_err(|_| AiError::internal())?
}

#[tauri::command]
pub async fn ai_extract_document_source(
    paths: tauri::State<'_, LibraryPaths>,
    attachment_id: String,
) -> Result<AiExtractedDocumentSource, AiError> {
    let paths = paths.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let data = read_attachment(&paths, &attachment_id)?;
        extract_document_source(data)
    })
    .await
    .map_err(|_| AiError::internal())?
}

fn truncate_utf8(text: &mut String, cap: usize) -> bool {
    if text.len() <= cap {
        return false;
    }
    let mut end = cap;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    text.truncate(end);
    true
}

fn operations_have_unresolved_graphics(
    operations: &[pdf_extract::content::Operation],
    extracted_image_count: usize,
) -> bool {
    let mut xobject_paints = 0usize;
    for operation in operations {
        match operation.operator.as_str() {
            // Explicitly painted/clipped vector paths and shadings.
            "S" | "s" | "f" | "F" | "f*" | "B" | "B*" | "b" | "b*" | "sh" | "W" | "W*" | "BI"
            | "ID" | "EI" => return true,
            // `get_page_images` accounts for Image XObjects. Any additional
            // `Do` is conservatively a Form XObject whose nested vectors and
            // layout are unavailable to Alcove's current extractor.
            "Do" => xobject_paints = xobject_paints.saturating_add(1),
            _ => {}
        }
    }
    xobject_paints > extracted_image_count
}

fn page_has_unresolved_graphics(
    document: &pdf_extract::Document,
    page_id: pdf_extract::ObjectId,
    extracted_image_count: usize,
) -> bool {
    let bytes = match document.get_page_content(page_id) {
        Ok(bytes) => bytes,
        // Failing to inspect a content stream must never be interpreted as a
        // proof that a page is text-only.
        Err(_) => return true,
    };
    let content = match pdf_extract::content::Content::decode(&bytes) {
        Ok(content) => content,
        Err(_) if bytes.iter().all(u8::is_ascii_whitespace) => return false,
        Err(_) => return true,
    };
    operations_have_unresolved_graphics(&content.operations, extracted_image_count)
}

fn extract_pdf_source(
    data: AiAttachmentData,
    paths: Option<&LibraryPaths>,
) -> Result<AiPdfSource, AiError> {
    if data.metadata.kind != AiAttachmentKind::Pdf || !data.bytes.starts_with(b"%PDF-") {
        return Err(AiError::new(
            AiErrorCode::PdfInvalid,
            "That attachment is not a PDF",
            false,
        ));
    }
    let mut document = pdf_extract::Document::load_mem(&data.bytes).map_err(|_| {
        AiError::new(
            AiErrorCode::PdfInvalid,
            "The PDF is malformed or unsupported",
            false,
        )
    })?;
    if document.is_encrypted() && document.decrypt("").is_err() {
        return Err(AiError::new(
            AiErrorCode::PdfInvalid,
            "Password-protected PDFs are not supported",
            false,
        ));
    }
    let page_map = document.get_pages();
    if page_map.is_empty() || page_map.len() > MAX_PDF_PAGES {
        return Err(AiError::new(
            AiErrorCode::PdfInvalid,
            "PDFs must contain between 1 and 500 pages",
            false,
        ));
    }

    let mut pages = Vec::with_capacity(page_map.len());
    let mut total_text_bytes = 0usize;
    let mut all_truncated = false;
    for (page_number, page_id) in page_map {
        let page_images = document.get_page_images(page_id).unwrap_or_default();
        let image_count = page_images.len();
        let has_vector_graphics = page_has_unresolved_graphics(&document, page_id, image_count);
        let mut visuals = Vec::new();
        for image in page_images.iter().take(MAX_PDF_VISUALS_PER_PAGE) {
            let is_plain_jpeg = image
                .filters
                .as_ref()
                .is_some_and(|filters| filters.as_slice() == ["DCTDecode"]);
            let dimensions_valid = image.width > 0
                && image.height > 0
                && image.width <= u32::MAX as i64
                && image.height <= u32::MAX as i64;
            if !is_plain_jpeg
                || !dimensions_valid
                || image.content.len() > MAX_IMAGE_BYTES
                || !matches!(sniff_attachment(image.content), Ok(AttachmentFormat::Jpeg))
            {
                continue;
            }
            let metadata = match paths {
                Some(paths) => store_attachment_bytes(paths, image.content)?,
                None => {
                    let digest = format!("{:x}", Sha256::digest(image.content));
                    metadata_for(
                        format!("att_{digest}.jpg"),
                        AttachmentFormat::Jpeg,
                        image.content.len() as u64,
                    )
                }
            };
            visuals.push(AiPdfVisual {
                attachment_id: metadata.id,
                mime_type: metadata.mime_type,
                sha256: metadata.sha256,
                width: image.width as u32,
                height: image.height as u32,
            });
        }
        let extracted = catch_unwind(AssertUnwindSafe(|| {
            let mut text = String::new();
            let mut output = pdf_extract::PlainTextOutput::new(&mut text);
            pdf_extract::output_doc_page(&document, &mut output, page_number).map(|_| text)
        }));
        let (mut text, extraction_failed) = match extracted {
            Ok(Ok(text)) => (text.replace('\0', ""), false),
            Ok(Err(_)) | Err(_) => (String::new(), true),
        };
        let mut text_truncated = truncate_utf8(&mut text, MAX_PDF_PAGE_TEXT_BYTES);
        let remaining = MAX_PDF_TOTAL_TEXT_BYTES.saturating_sub(total_text_bytes);
        if text.len() > remaining {
            text_truncated |= truncate_utf8(&mut text, remaining);
            all_truncated = true;
        }
        total_text_bytes += text.len();
        if text_truncated {
            all_truncated = true;
        }
        let visible_chars = text
            .chars()
            .filter(|character| !character.is_whitespace())
            .count();
        let needs_ocr = extraction_failed || visible_chars < 40;
        // Extracted text and JPEG XObjects are not a raster of the composed
        // page. Even a text-only page can carry meaning in positioning,
        // clipping, fonts, and layout. Until Alcove can return a verified
        // full-page render, every PDF page remains unresolved visual evidence
        // for preserve-everything tasks. Adaptive/non-preserve tasks may still
        // use the extracted text and supporting images.
        let needs_visual_review = true;
        let unresolved_visual_count = image_count
            .saturating_sub(visuals.len())
            .saturating_add(usize::from(has_vector_graphics))
            .max(1);
        let visual_evidence = AiPdfVisualEvidence::Unresolved;
        pages.push(AiPdfSourcePage {
            page_number,
            text_bytes: text.len(),
            text,
            truncated: text_truncated,
            extraction_failed,
            needs_ocr,
            needs_visual_review,
            has_embedded_images: image_count > 0,
            has_vector_graphics,
            visual_evidence,
            unresolved_visual_count,
            visuals,
        });
    }
    Ok(AiPdfSource {
        attachment_id: data.metadata.id,
        sha256: data.metadata.sha256,
        page_count: pages.len(),
        total_text_bytes,
        truncated: all_truncated,
        pages,
    })
}

#[tauri::command]
pub async fn ai_extract_pdf_source(
    paths: tauri::State<'_, LibraryPaths>,
    attachment_id: String,
) -> Result<AiPdfSource, AiError> {
    let paths = paths.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let data = read_attachment(&paths, &attachment_id)?;
        catch_unwind(AssertUnwindSafe(|| extract_pdf_source(data, Some(&paths)))).map_err(|_| {
            AiError::new(
                AiErrorCode::PdfInvalid,
                "The PDF is malformed or unsupported",
                false,
            )
        })?
    })
    .await
    .map_err(|_| AiError::internal())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use zip::{write::SimpleFileOptions, ZipWriter};

    const ONE_PIXEL_PNG: &str =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

    fn parse_chat(value: JsonValue) -> AiChatRequest {
        serde_json::from_value(value).expect("test chat request must deserialize")
    }

    fn office_package(entries: &[(&str, &str)]) -> Vec<u8> {
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        for (name, contents) in entries {
            writer
                .start_file(*name, SimpleFileOptions::default())
                .expect("fixture entry should start");
            writer
                .write_all(contents.as_bytes())
                .expect("fixture entry should write");
        }
        writer
            .finish()
            .expect("fixture package should finish")
            .into_inner()
    }

    #[test]
    fn credential_input_is_narrow_and_never_serializable() {
        assert_eq!(
            normalize_api_key("  cohere_test_key_123456  ".to_string())
                .expect("trimmed key should be accepted")
                .expose(),
            "cohere_test_key_123456"
        );
        assert!(normalize_api_key("short".to_string()).is_err());
        assert!(normalize_api_key("cohere test key 123456".to_string()).is_err());
        assert!(normalize_api_key("cohere_test_key_12345\0".to_string()).is_err());

        // SecretString deliberately implements neither Serialize nor Debug.
        // The public credential responses contain status only.
        let status = AiCredentialStatus {
            configured: true,
            source: Some(AiCredentialSource::Session),
            secure_store_available: false,
            persistent: false,
        };
        let encoded = serde_json::to_string(&status).expect("status should serialize");
        assert_eq!(
            encoded,
            r#"{"configured":true,"source":"session","secureStoreAvailable":false,"persistent":false}"#
        );
    }

    #[test]
    fn credential_revocation_cancels_every_registered_provider_run() {
        let state = AiState::new().expect("AI state should initialize");
        let (chat, _chat_active) = state
            .register_run("chat_revocation_test")
            .expect("chat run should register");
        let (embed, _embed_active) = state
            .register_run("embed_revocation_test")
            .expect("embed run should register");
        let (rerank, _rerank_active) = state
            .register_run("rerank_revocation_test")
            .expect("rerank run should register");

        assert_eq!(
            state.cancel_all_runs().expect("revocation should cancel"),
            3
        );
        assert!(chat.is_cancelled());
        assert!(embed.is_cancelled());
        assert!(rerank.is_cancelled());
    }

    #[tokio::test]
    async fn credential_delete_cancels_an_overlapping_effective_key_test() {
        let state = AiState::new().expect("AI state should initialize");
        *lock(&state.session_key).expect("session key lock should be available") = Some(
            normalize_api_key("cohere_test_key_123456".to_string())
                .expect("test credential should be valid"),
        );

        // This is the exact effective-key registration seam used by
        // ai_credential_test. At this point it has cloned the session key and
        // published its cancellation control atomically.
        let (_key, control, active_run) = state
            .register_credential_test_run(None)
            .expect("effective-key test should register");
        let waiting_control = control.clone();
        // Exercise the exact backoff seam used after a retryable key-check
        // response: revocation must not wait for the retry timer to expire.
        let provider_wait = tokio::spawn(async move {
            cancellable_sleep(&waiting_control, Duration::from_secs(60)).await
        });
        tokio::task::yield_now().await;

        // ai_credential_delete holds this lifecycle lock and calls this same
        // revocation helper before touching the native secure store.
        {
            let _guard = lock(&state.credential_lock)
                .expect("credential lifecycle lock should be available");
            assert_eq!(
                state
                    .revoke_active_runs_and_session_key_unlocked()
                    .expect("credential revocation should succeed"),
                1
            );
        }

        let error = tokio::time::timeout(Duration::from_secs(1), provider_wait)
            .await
            .expect("revocation should wake the provider wait immediately")
            .expect("provider wait task should not panic")
            .expect_err("the overlapping key test must be cancelled");
        assert_eq!(error.code, AiErrorCode::Cancelled);
        assert!(lock(&state.session_key)
            .expect("session key lock should remain available")
            .is_none());
        assert!(control.is_cancelled());

        drop(active_run);
        assert!(lock(&state.runs)
            .expect("run registry should remain available")
            .active
            .is_empty());
    }

    #[test]
    fn cancellation_before_registration_is_consumed_before_network_work_can_start() {
        let state = AiState::new().expect("AI state should initialize");
        state
            .cancel_run("cancel-before-register")
            .expect("pre-registration cancellation should be retained");

        let error = match state.register_run("cancel-before-register") {
            Ok(_) => panic!("the later provider registration must fail closed"),
            Err(error) => error,
        };
        assert_eq!(error.code, AiErrorCode::Cancelled);
        assert!(lock(&state.runs)
            .expect("run registry should remain available")
            .active
            .is_empty());

        // The intent is one-shot. Run ids are unique in production, but
        // consuming it avoids turning Stop into a permanent denial for an id.
        let (_control, active) = state
            .register_run("cancel-before-register")
            .expect("a new registration may reuse the consumed test id");
        drop(active);
    }

    #[test]
    fn chat_preserves_multimodal_tool_plan_and_result_messages() {
        let request = parse_chat(json!({
            "runId": "visual-review:page-7",
            "model": "command-a-plus-05-2026",
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "Review this locally rendered page."},
                        {
                            "type": "image_url",
                            "imageUrl": {
                                "url": format!("data:image/png;base64,{ONE_PIXEL_PNG}"),
                                "detail": "high"
                            }
                        }
                    ]
                },
                {
                    "role": "assistant",
                    "toolPlan": "Inspect, then edit only if needed.",
                    "toolCalls": [{
                        "id": "call_1",
                        "type": "function",
                        "function": {
                            "name": "replace_page_blocks",
                            "arguments": "{\"page\":7}"
                        }
                    }]
                },
                {
                    "role": "tool",
                    "toolCallId": "call_1",
                    "content": [{
                        "type": "document",
                        "document": {"id": "result_1", "data": {"ok": true}}
                    }]
                }
            ],
            "tools": [{
                "name": "replace_page_blocks",
                "description": "Replace an approved page draft.",
                "parameters": {
                    "type": "object",
                    "properties": {"page": {"type": "integer"}},
                    "required": ["page"]
                }
            }]
        }));

        let provider = validate_chat_request(&request).expect("request should validate");
        assert_eq!(provider["model"], "command-a-plus-05-2026");
        assert_eq!(provider["stream"], true);
        assert!(provider.get("run_id").is_none());
        assert_eq!(
            provider["messages"][0]["content"][1]["image_url"]["detail"],
            "high"
        );
        assert_eq!(
            provider["messages"][1]["tool_plan"],
            "Inspect, then edit only if needed."
        );
        assert_eq!(
            provider["messages"][1]["tool_calls"][0]["function"]["name"],
            "replace_page_blocks"
        );
        assert_eq!(provider["messages"][2]["tool_call_id"], "call_1");
        assert_eq!(provider["tools"][0]["type"], "function");
    }

    #[test]
    fn chat_preserves_documents_and_citation_mode() {
        let request = parse_chat(json!({
            "runId": "citation-run",
            "model": "command-a-plus-05-2026",
            "messages": [{"role": "user", "content": "Summarize with citations."}],
            "documents": [{
                "id": "page-12",
                "data": {"title": "Page 12", "text": "A locally extracted passage."}
            }],
            "citationMode": "accurate"
        }));

        let provider = validate_chat_request(&request).expect("citation request should validate");
        assert_eq!(provider["citation_options"]["mode"], "ACCURATE");
        assert_eq!(provider["documents"][0]["id"], "page-12");
        assert_eq!(
            provider["documents"][0]["data"]["text"],
            "A locally extracted passage."
        );
    }

    #[test]
    fn provider_and_schema_allowlists_reject_untrusted_expansion() {
        assert!(serde_json::from_value::<AiChatRequest>(json!({
            "runId": "bad-model",
            "model": "command-r-plus",
            "messages": [{"role": "user", "content": "hello"}]
        }))
        .is_err());

        let remote_image = parse_chat(json!({
            "runId": "remote-image",
            "model": "command-a-plus-05-2026",
            "messages": [{
                "role": "user",
                "content": [{
                    "type": "image_url",
                    "imageUrl": {"url": "https://example.invalid/private.png"}
                }]
            }]
        }));
        let error = validate_chat_request(&remote_image).expect_err("remote URL must be rejected");
        assert_eq!(error.code, AiErrorCode::InvalidRequest);

        let unsupported_schema = json!({
            "type": "object",
            "properties": {"count": {"type": "integer", "minimum": 0}},
            "required": ["count"]
        });
        assert!(validate_json_schema(&unsupported_schema, true).is_err());
    }

    #[test]
    fn embed_and_rerank_v4_requests_are_typed_and_capped() {
        let embed: AiEmbedRequest = serde_json::from_value(json!({
            "runId": "embed-1",
            "model": "embed-v4.0",
            "inputType": "search_document",
            "inputs": [{"content": [{"type": "text", "text": "page one"}]}],
            "outputDimension": 1024,
            "embeddingTypes": ["float"]
        }))
        .expect("embed request should deserialize");
        let embed_body = embed.validate_and_build().expect("embed should validate");
        assert_eq!(embed_body["model"], "embed-v4.0");
        assert_eq!(embed_body["input_type"], "search_document");
        assert_eq!(embed_body["output_dimension"], 1024);

        let rerank: AiRerankRequest = serde_json::from_value(json!({
            "runId": "rerank-1",
            "model": "rerank-v4.0-pro",
            "query": "which page?",
            "documents": ["page one", "page two"],
            "topN": 1
        }))
        .expect("rerank request should deserialize");
        let rerank_body = rerank.validate_and_build().expect("rerank should validate");
        assert_eq!(rerank_body["model"], "rerank-v4.0-pro");
        assert_eq!(rerank_body["top_n"], 1);

        let response = AiRerankResult {
            index: 0,
            relevance_score: 0.75,
        };
        assert_eq!(
            serde_json::to_value(response).expect("response should serialize"),
            json!({"index": 0, "relevanceScore": 0.75})
        );
    }

    #[test]
    fn sse_decoder_handles_chunk_boundaries_multiline_data_and_debug() {
        let mut decoder = SseDecoder::new();
        assert!(decoder
            .push(b"event: content-delta\r\ndata: first\r\n")
            .expect("partial frame should be valid")
            .is_empty());
        let events = decoder
            .push(b"data: second\r\n\r\n")
            .expect("completed frame should be valid");
        assert_eq!(
            events,
            vec![("content-delta".to_string(), "first\nsecond".to_string())]
        );
        decoder.finish().expect("decoder should finish cleanly");
        assert_eq!(
            AiProviderEventType::parse("debug"),
            Some(AiProviderEventType::Debug)
        );
        assert_eq!(
            serde_json::to_string(&AiProviderEventType::Debug).expect("event should serialize"),
            "\"debug\""
        );

        let mut incomplete = SseDecoder::new();
        incomplete
            .push(b"event: content-delta\ndata: unfinished")
            .expect("buffering is valid");
        assert!(incomplete.finish().is_err());
    }

    #[test]
    fn retry_after_and_error_mapping_are_redacted() {
        let mut headers = header::HeaderMap::new();
        headers.insert(header::RETRY_AFTER, header::HeaderValue::from_static("120"));
        assert_eq!(retry_delay(&headers, 1), MAX_RETRY_DELAY);

        let error = status_error(StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(error.code, AiErrorCode::RateLimited);
        assert!(error.retryable);
        assert_eq!(error.status, Some(429));
        let encoded = serde_json::to_string(&error).expect("error should serialize");
        assert!(!encoded.contains("response_body"));
        assert!(!encoded.contains("authorization"));
    }

    #[test]
    fn attachment_magic_and_ids_are_canonical() {
        assert!(matches!(
            sniff_attachment(b"%PDF-1.7\n"),
            Ok(AttachmentFormat::Pdf)
        ));
        assert!(matches!(
            sniff_attachment(b"not a supported attachment"),
            Ok(AttachmentFormat::Text)
        ));
        assert!(sniff_attachment(b"\0\x01\x02unsupported binary").is_err());
        assert!(validate_attachment_id("../../secret.pdf").is_err());
        assert!(validate_attachment_id(
            "att_ABCDEF0123456789abcdef0123456789abcdef0123456789abcdef0123456789.pdf"
        )
        .is_err());
        assert!(matches!(
            validate_attachment_id(
                "att_abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789.pdf"
            ),
            Ok(AttachmentFormat::Pdf)
        ));
        assert!(matches!(
            validate_attachment_id(
                "preview_abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789.png"
            ),
            Ok(AttachmentFormat::Png)
        ));

        let png_uri = format!("data:image/png;base64,{ONE_PIXEL_PNG}");
        assert!(validate_image_data_uri(&png_uri).is_ok());
        let mismatched = format!("data:image/jpeg;base64,{ONE_PIXEL_PNG}");
        assert!(validate_image_data_uri(&mismatched).is_err());
    }

    #[test]
    fn text_code_and_data_are_utf8_only_and_office_packages_are_bounded() {
        assert!(matches!(
            sniff_attachment(b"fn main() { println!(\"hello\"); }\n"),
            Ok(AttachmentFormat::Text)
        ));
        assert!(matches!(
            sniff_attachment(br#"{"hello":"world"}"#),
            Ok(AttachmentFormat::Text)
        ));
        assert!(matches!(
            sniff_attachment(b"name,score\nAda,10\n"),
            Ok(AttachmentFormat::Text)
        ));
        assert!(sniff_attachment(b"\0\x01\x02binary").is_err());
        assert!(sniff_attachment(&[0xff, 0xfe, 0xfd]).is_err());

        let docx = office_package(&[
            ("[Content_Types].xml", "<Types/>"),
            (
                "word/document.xml",
                r#"<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>Hello &amp; goodbye</w:t></w:r></w:p><w:p><w:r><w:t>Second line</w:t></w:r></w:p></w:body></w:document>"#,
            ),
        ]);
        assert!(matches!(
            sniff_attachment(&docx),
            Ok(AttachmentFormat::Docx)
        ));
        let (text, labels, warnings) = extract_docx_text(&docx).expect("DOCX should extract");
        assert_eq!(text, "## Document body\nHello & goodbye\nSecond line");
        assert_eq!(labels, vec!["document body"]);
        assert!(warnings[0].contains("Embedded media"));

        let macro_docx = office_package(&[
            ("word/document.xml", "<w:document xmlns:w=\"w\"/>"),
            ("word/vbaProject.bin", "do not execute"),
        ]);
        assert!(sniff_attachment(&macro_docx).is_err());

        let external_xlsx = office_package(&[
            ("xl/workbook.xml", "<workbook/>"),
            ("xl/externalLinks/externalLink1.xml", "<externalLink/>"),
        ]);
        assert!(sniff_attachment(&external_xlsx).is_err());
    }

    #[test]
    fn xlsx_extraction_reads_cached_cells_without_evaluating_formulas() {
        let xlsx = office_package(&[
            ("[Content_Types].xml", "<Types/>"),
            ("xl/workbook.xml", "<workbook/>"),
            (
                "xl/sharedStrings.xml",
                r#"<sst><si><t>Name</t></si><si><t>Ada</t></si></sst>"#,
            ),
            (
                "xl/worksheets/sheet1.xml",
                r#"<worksheet><sheetData><row><c r="A1" t="s"><v>0</v></c><c r="C1"><v>Score</v></c></row><row><c r="A2" t="s"><v>1</v></c><c r="C2"><f>1+1</f><v>2</v></c></row></sheetData></worksheet>"#,
            ),
            (
                "xl/worksheets/sheet10.xml",
                r#"<worksheet><sheetData><row><c r="A1"><v>Tenth</v></c></row></sheetData></worksheet>"#,
            ),
            (
                "xl/worksheets/sheet2.xml",
                r#"<worksheet><sheetData><row><c r="A1"><v>Second</v></c></row></sheetData></worksheet>"#,
            ),
        ]);
        assert!(matches!(
            sniff_attachment(&xlsx),
            Ok(AttachmentFormat::Xlsx)
        ));
        let (text, labels, warnings) = extract_xlsx_text(&xlsx).expect("XLSX should extract");
        assert_eq!(text, "## Sheet 1\nA1=Name\tC1=Score\nA2=Ada\tC2==1+1 → 2\n\n## Sheet 2\nA1=Second\n\n## Sheet 10\nA1=Tenth");
        assert_eq!(labels, vec!["sheet 1", "sheet 2", "sheet 10"]);
        assert!(
            text.find("Second").expect("second sheet") < text.find("Tenth").expect("tenth sheet")
        );
        assert!(warnings[0].contains("never evaluated"));
        assert!(text.contains("1+1"));
    }

    #[test]
    fn document_truncation_preserves_utf8_boundaries() {
        let mut text = "ab😀cd".to_string();
        assert!(truncate_utf8(&mut text, 4));
        assert_eq!(text, "ab");
        assert!(std::str::from_utf8(text.as_bytes()).is_ok());
    }

    #[test]
    fn pptx_extraction_preserves_slide_and_speaker_note_order_without_rendering() {
        let pptx = office_package(&[
            ("[Content_Types].xml", "<Types/>"),
            ("ppt/presentation.xml", "<p:presentation xmlns:p=\"p\"/>"),
            (
                "ppt/slides/slide2.xml",
                r#"<p:sld xmlns:p="p" xmlns:a="a"><a:p><a:r><a:t>Second slide</a:t></a:r></a:p></p:sld>"#,
            ),
            (
                "ppt/slides/slide1.xml",
                r#"<p:sld xmlns:p="p" xmlns:a="a"><a:p><a:r><a:t>Opening slide</a:t></a:r></a:p></p:sld>"#,
            ),
            (
                "ppt/notesSlides/notesSlide1.xml",
                r#"<p:notes xmlns:p="p" xmlns:a="a"><a:p><a:r><a:t>Say hello</a:t></a:r></a:p></p:notes>"#,
            ),
        ]);
        assert!(matches!(
            sniff_attachment(&pptx),
            Ok(AttachmentFormat::Pptx)
        ));
        let (text, labels, warnings) = extract_pptx_text(&pptx).expect("PPTX should extract");
        assert_eq!(labels, vec!["slide 1", "slide 2", "speaker notes 1"]);
        assert_eq!(text, "## slide 1\nOpening slide\n\n## slide 2\nSecond slide\n\n## speaker notes 1\nSay hello");
        assert!(warnings[0].contains("not represented"));
    }

    #[test]
    fn image_only_pdf_reports_ocr_and_visual_review_needs() {
        let mut jpeg = vec![0xff, 0xd8, 0xff, 0xe0];
        jpeg.resize(62, 0xab);
        jpeg.extend_from_slice(&[0xff, 0xd9]);
        let bytes = crate::export::build_jpeg_pdf(
            &[crate::export::PdfPageImage {
                jpeg,
                width: 32,
                height: 32,
            }],
            192.0,
        )
        .expect("fixture PDF should build");
        let sha256 = format!("{:x}", Sha256::digest(&bytes));
        let data = AiAttachmentData {
            metadata: AiAttachmentMetadata {
                id: format!("att_{sha256}.pdf"),
                kind: AiAttachmentKind::Pdf,
                mime_type: "application/pdf".to_string(),
                size_bytes: bytes.len() as u64,
                sha256,
            },
            bytes,
        };

        let source = extract_pdf_source(data, None).expect("fixture PDF should extract");
        assert_eq!(source.page_count, 1);
        assert_eq!(source.pages[0].page_number, 1);
        assert!(source.pages[0].needs_ocr);
        assert!(source.pages[0].needs_visual_review);
        assert!(source.pages[0].has_embedded_images);
        assert!(!source.pages[0].has_vector_graphics);
        assert_eq!(
            source.pages[0].visual_evidence,
            AiPdfVisualEvidence::Unresolved
        );
        assert_eq!(source.pages[0].unresolved_visual_count, 1);
        assert_eq!(source.pages[0].visuals.len(), 1);
        assert_eq!(source.pages[0].visuals[0].mime_type, "image/jpeg");
        assert_eq!(source.pages[0].visuals[0].width, 32);
        assert_eq!(source.pages[0].visuals[0].height, 32);
        assert!(source.pages[0].visuals[0].attachment_id.starts_with("att_"));
        assert_eq!(source.pages[0].text_bytes, source.pages[0].text.len());
        let encoded = serde_json::to_value(&source).expect("PDF source should serialize");
        assert_eq!(encoded["pages"][0]["visualEvidence"], "unresolved");
        assert_eq!(encoded["pages"][0]["hasVectorGraphics"], false);
        assert_eq!(encoded["pages"][0]["visuals"][0]["mimeType"], "image/jpeg");
    }

    #[test]
    fn scan_only_pdf_never_claims_visual_coverage_without_extractable_pixels() {
        // The page is a scan-only DCT XObject, but its payload is not a valid
        // managed JPEG. PDF text extraction still succeeds (with no text), so
        // this is the exact case that used to be marked "needs visual review"
        // without providing pixels and could later be counted as read.
        let bytes = crate::export::build_jpeg_pdf(
            &[crate::export::PdfPageImage {
                jpeg: vec![0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02, 0x03],
                width: 64,
                height: 96,
            }],
            192.0,
        )
        .expect("fixture PDF should build");
        let sha256 = format!("{:x}", Sha256::digest(&bytes));
        let data = AiAttachmentData {
            metadata: AiAttachmentMetadata {
                id: format!("att_{sha256}.pdf"),
                kind: AiAttachmentKind::Pdf,
                mime_type: "application/pdf".to_string(),
                size_bytes: bytes.len() as u64,
                sha256,
            },
            bytes,
        };

        let source = extract_pdf_source(data, None).expect("fixture PDF should extract");
        let page = &source.pages[0];
        assert!(page.needs_ocr);
        assert!(page.needs_visual_review);
        assert!(page.has_embedded_images);
        assert_eq!(page.visual_evidence, AiPdfVisualEvidence::Unresolved);
        assert_eq!(page.unresolved_visual_count, 1);
        assert!(page.visuals.is_empty());
    }

    #[test]
    fn vector_and_form_paints_fail_closed_without_page_pixels() {
        use pdf_extract::content::Operation;

        let vector = vec![Operation::new("m", vec![]), Operation::new("S", vec![])];
        assert!(operations_have_unresolved_graphics(&vector, 0));

        let unaccounted_form = vec![Operation::new("Do", vec![])];
        assert!(operations_have_unresolved_graphics(&unaccounted_form, 0));
        assert!(!operations_have_unresolved_graphics(&unaccounted_form, 1));
    }
}
