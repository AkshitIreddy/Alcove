---
title: "Huffman Coding with Kittens"
paper: grid
wash: amber
---

# Huffman Coding with Kittens

At a kitten shelter, common sounds get the shortest tags. That is Huffman coding: spend fewer bits on symbols you meet more often.

![Huffman coding infographic using five kitten sounds](__HUFFMAN_KITTENS_BLOB_URL__){caption="The attached kitten guide: frequencies, merges and final prefix-free codes", style=polaroid, width=62}

::: callout {variant=tip title="The tiny rule"}
Frequent sound → short code. Rare sound → longer code. No code may begin another code.
:::

::page
# Build the Kitten Tree

Start with the two quietest frequencies. Merge them, then put their total back into the queue.

**Frequencies:** Meow `0.40` · Purr `0.25` · Chirp `0.15` · Hiss `0.10` · Squeak `0.10`

### Merge queue

Hiss + Squeak → `0.20` → with Chirp `0.35` → with Purr `0.60` → with Meow, root `1.00`.

::: callout {variant=tip title="Read the path"}
Write **0** on left edges and **1** on right edges. A sound's code is its root-to-leaf path.
:::

::page
# Read, Check, Decode

::: columns {gap=lg}
::: col
### Kitten codes
- Meow `0`
- Purr `10`
- Chirp `110`
- Hiss `1110`
- Squeak `1111`
:::
::: col
### Why it works
Every code ends at a leaf. No complete code begins a longer one, so decoding never guesses.

**Kraft check:** the five code weights add to exactly `1`.
:::
:::

### Try it

Decode `0 10 110`.

**Answer:** Meow, Purr, Chirp. Reach a leaf, reset to the root, then read the next code.
