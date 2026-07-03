// Section: After Sales (loadAfterSales)
let afterSalesLoaded = false;

async function loadAfterSales() {
  if (afterSalesLoaded) return;
  const loading = document.getElementById('aftersales-loading');
  const errEl   = document.getElementById('aftersales-error');
  const grid    = document.getElementById('aftersales-cat-grid');
  if (loading) loading.style.display = 'block';
  try {
    await CN.load();
    const section = CN.getSection('After Sales');
    if (!section) throw new Error('After Sales section not found in content_nodes');
    const cats = CN.getCategories(section.id);
    afterSalesLoaded = true;
    cnRenderCatGrid(grid, cats, loading, errEl, 'cnOpenAfterSalesOverlay');
  } catch(e) {
    if (loading) loading.style.display = 'none';
    if (errEl)   { errEl.style.display = 'block'; errEl.innerHTML = '<div style="text-align:center;padding:32px 16px;color:var(--muted);">⚠️ ' + e.message + '</div>'; }
  }
}

function cnOpenAfterSalesOverlay(nodeId, catName) {
  cnOpenOverlay(nodeId, catName, 'afterSalesOverlay', 'asOverlayTitle', 'asOverlaySub',
                'asOverlayGrid', 'asOverlayLoader', 'asOverlayEmpty');
}

function closeAfterSalesOverlay() {
  document.getElementById('afterSalesOverlay').style.display = 'none';
  document.body.style.overflow = '';
}

