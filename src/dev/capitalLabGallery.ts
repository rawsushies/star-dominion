// Gallery mode of the capital laboratory: the committed screenshots side by side.

export function renderGallery() {
  const rows: [string, string][] = [['a', 'A · Current production'], ['b', 'B · New lighting and post-processing, existing assets'], ['c', 'C · Terraced island diorama (KayKit CC0 environment)'], ['c-ortho', 'C · Orthographic camera'], ['c-mobile', 'C · Mobile quality tier'], ['b-mobile', 'B · Mobile quality tier']];
  document.body.innerHTML = `<main style="height:100%;overflow:auto;padding:16px;max-width:1500px;margin:0 auto"><h1 style="font-size:18px;margin:0 0 4px">Capital laboratory: rendered comparison</h1>
    <p style="color:#a7b2c4;margin:0 0 16px;max-width:75ch">The same sample capital and camera angle in every variant, captured headlessly at 1440×900 and 390×844 by <code>scripts/capture-capital-lab.mjs</code>. Open a variant live with the buttons on the lab page.</p>
    ${rows.map(([id, title]) => `<section style="margin:0 0 28px"><h2 style="font-size:14px;margin:0 0 8px">${title} · <a style="color:#8fb4ff" href="?variant=${id[0]}${id.includes('mobile') ? '&quality=mobile' : ''}${id.includes('ortho') ? '&projection=orthographic' : ''}">open live</a></h2>
      <div style="display:grid;grid-template-columns:minmax(0,1440fr) minmax(0,390fr);gap:12px;align-items:start">
        <img style="width:100%;border:1px solid #334055" src="/docs/asset-previews/m12/${id}-desktop.jpg" alt="${title}, desktop" onerror="this.replaceWith(Object.assign(document.createElement('p'),{textContent:'Desktop capture not generated for this variant.',style:'color:#a7b2c4'}))">
        <img style="width:100%;border:1px solid #334055" src="/docs/asset-previews/m12/${id}-phone.jpg" alt="${title}, phone"></div></section>`).join('')}</main>`;
}
