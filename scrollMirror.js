// Mirrors the bottom horizontal scrollbar on top of long tables, so the user
// doesn't need to scroll to the end of the table to drag the page sideways.
// Skipped on touch-primary devices — native momentum scroll is enough there.
(function () {
  if (window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches) return

  const ATTR = 'data-scroll-mirror-attached'
  const SEL = '[style*="overflow-x:auto"], [style*="overflow-x: auto"]'

  function attach(scroller) {
    if (!scroller || scroller.getAttribute(ATTR) === '1') return
    if (!scroller.parentNode) return
    scroller.setAttribute(ATTR, '1')

    const mirror = document.createElement('div')
    mirror.className = 'scroll-x-mirror'
    const inner = document.createElement('div')
    mirror.appendChild(inner)
    scroller.parentNode.insertBefore(mirror, scroller)

    let lock = false
    mirror.addEventListener('scroll', () => {
      if (lock) return
      lock = true
      scroller.scrollLeft = mirror.scrollLeft
      requestAnimationFrame(() => { lock = false })
    }, { passive: true })
    scroller.addEventListener('scroll', () => {
      if (lock) return
      lock = true
      mirror.scrollLeft = scroller.scrollLeft
      requestAnimationFrame(() => { lock = false })
    }, { passive: true })

    const sync = () => {
      const w = scroller.scrollWidth
      const cw = scroller.clientWidth
      inner.style.width = w + 'px'
      mirror.style.display = w > cw + 1 ? '' : 'none'
      mirror.scrollLeft = scroller.scrollLeft
    }

    if (window.ResizeObserver) {
      const ro = new ResizeObserver(sync)
      ro.observe(scroller)
      Array.from(scroller.children).forEach(c => ro.observe(c))
    }
    requestAnimationFrame(sync)
    setTimeout(sync, 100)
    setTimeout(sync, 500)
  }

  function scan(root) {
    if (!root || !root.querySelectorAll) return
    if (root.matches && root.matches(SEL)) attach(root)
    root.querySelectorAll(SEL).forEach(attach)
  }

  function init() {
    scan(document.body)
    if (!window.MutationObserver) return
    new MutationObserver(muts => {
      for (const m of muts) {
        for (const n of m.addedNodes) {
          if (n.nodeType === 1) scan(n)
        }
      }
    }).observe(document.body, { childList: true, subtree: true })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
