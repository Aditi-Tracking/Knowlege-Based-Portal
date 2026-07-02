// Section: Finance (nav visibility)
function _applyFinanceNavVisibility() {
  const el   = document.getElementById('nav-finance');
  const mmEl = document.getElementById('mm-finance');
  if (el)   el.style.display   = '';
  if (mmEl) mmEl.style.display = 'flex';
}
