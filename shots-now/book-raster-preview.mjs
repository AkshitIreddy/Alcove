import {chromium} from 'playwright';
const b=await chromium.launch({headless:true}); const p=await b.newPage({viewport:{width:700,height:990}});
await p.goto('http://127.0.0.1:1420');
await p.evaluate(async()=>{document.body.innerHTML='';document.body.style.cssText='margin:0;background:#f5efdf';let im=new Image();im.src='/assets/book-art/imagegen/frames/open-dentelle.png';await im.decode();im.style.cssText='width:660px;height:990px;object-fit:contain';document.body.append(im)});
await p.screenshot({path:'shots-now/out/book-raster-frame-preview.png'}); await b.close();
