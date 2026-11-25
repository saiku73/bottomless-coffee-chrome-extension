(function () {
  'use strict';

  const Logic = window.BottomlessStarredLogic;
  if (!Logic) return;

  const ORDERS_API_URL = 'https://app.bottomless.com/api/orders';
  const IN_TRANSITION_API_URL = 'https://app.bottomless.com/api/orders/in-transition';
  const PREF_GROUP_KEY = 'btl_starred_group_repeats';
  const PREF_COLLAPSE_KEY = 'btl_starred_collapsed';

  const SECTION_ATTR = 'data-btl-starred-section';
  const HIDDEN_ORDER_CLASS = 'btl-hidden-order';
  const HIDDEN_GROUP_CLASS = 'btl-hidden-group';

  const state = {
    lastPathname: '',
    fetchInFlight: null,
    classified: null,
    inTransitionOrders: [],
    lastRenderSignature: '',
    groupRepeats: readBoolPref(PREF_GROUP_KEY, true),
    collapsed: readBoolPref(PREF_COLLAPSE_KEY, false),
    isApplyingDom: false,
    scheduledTimer: null,
  };

  function readBoolPref(key, fallback) {
    try {
      const val = window.localStorage.getItem(key);
      if (val === 'true') return true;
      if (val === 'false') return false;
    } catch (_) {
      // Ignore storage access errors
    }
    return fallback;
  }

  function writeBoolPref(key, value) {
    try {
      window.localStorage.setItem(key, value ? 'true' : 'false');
    } catch (_) {
      // Ignore storage access errors
    }
  }

  function isOrdersPage() {
    const path = window.location.pathname.replace(/\/+$/, '') || '/';
    return path === '/orders';
  }

  function buildAuthHeaders() {
    let storedToken = null;
    try {
      storedToken = window.localStorage.getItem('bottomless_access_token');
    } catch (_) {
      storedToken = null;
    }
    const token = Logic.getAuthToken(storedToken, document.cookie);
    const headers = { Accept: 'application/json' };
    if (token) {
      headers.Authorization = token;
    }
    return headers;
  }

  async function fetchJson(url) {
    const res = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      headers: buildAuthHeaders(),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} for ${url}`);
    }
    return res.json();
  }

  async function loadOrdersData(forceRefresh) {
    if (!forceRefresh && state.classified) {
      return state.classified;
    }
    if (state.fetchInFlight) {
      return state.fetchInFlight;
    }

    state.fetchInFlight = (async () => {
      try {
        const [ordersPayload, inTransitionPayload] = await Promise.all([
          fetchJson(ORDERS_API_URL),
          fetchJson(IN_TRANSITION_API_URL).catch(() => ({ data: [] })),
        ]);
        const orders = Array.isArray(ordersPayload && ordersPayload.data)
          ? ordersPayload.data
          : [];
        state.inTransitionOrders = Array.isArray(
          inTransitionPayload && inTransitionPayload.data
        )
          ? inTransitionPayload.data
          : [];
        state.classified = Logic.classifyOrders(orders);
        return state.classified;
      } catch (err) {
        console.debug('[Bottomless Starred] Unable to load orders:', err);
        return null;
      } finally {
        state.fetchInFlight = null;
      }
    })();

    return state.fetchInFlight;
  }

  function findPanelSections() {
    const sections = Array.from(
      document.querySelectorAll('#panel-content section.panel-section')
    ).filter((el) => !el.hasAttribute(SECTION_ATTR));

    let inProgressSection = null;
    let historySection = null;

    for (const sec of sections) {
      const titleEl = sec.querySelector('header h5.title, h5.title');
      const titleText = titleEl ? titleEl.textContent.trim().toLowerCase() : '';
      if (titleText === 'in progress') {
        inProgressSection = sec;
      } else if (titleText === 'history') {
        historySection = sec;
      }
    }

    return { inProgressSection, historySection };
  }

  function extractCardDetailsFromDom(anchorEl) {
    if (!anchorEl) return null;
    const imgEl = anchorEl.querySelector('img');
    const vendorEl = anchorEl.querySelector('.text-uppercase.text-secondary');
    const strongEl = anchorEl.querySelector('strong');
    const dateLabelEl = anchorEl.querySelector('.text-right .extra-small');
    const dateValueEl = anchorEl.querySelector('.text-right .font-weight-bold');

    return {
      imageSrc: imgEl ? imgEl.getAttribute('src') || '' : '',
      vendorName: vendorEl ? vendorEl.textContent.trim() : '',
      name: strongEl ? strongEl.textContent.trim() : '',
      dateLabel: dateLabelEl ? dateLabelEl.textContent.trim() : '',
      dateText: dateValueEl ? dateValueEl.textContent.trim() : '',
    };
  }

  function createChevronSvg() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', '20');
    svg.setAttribute('height', '20');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');

    const poly = document.createElementNS(ns, 'polyline');
    poly.setAttribute('points', '9 18 15 12 9 6');
    svg.appendChild(poly);
    return svg;
  }

  function buildStarredCardCol(item, domLinkMap) {
    const col = document.createElement('div');
    col.className = 'mb-3 col-12 col-md-6';

    const originalAnchor = domLinkMap.get(item.orderId) || null;
    const domDetails = extractCardDetailsFromDom(originalAnchor);

    const imageSrc = (domDetails && domDetails.imageSrc) || item.imageSrc;
    const vendorName = (domDetails && domDetails.vendorName) || item.vendorName;
    const coffeeName = (domDetails && domDetails.name) || item.name;
    const dateLabel = (domDetails && domDetails.dateLabel) || item.dateLabel;
    const dateText = (domDetails && domDetails.dateText) || item.dateText;

    const link = document.createElement('a');
    link.className = 'd-block box-link btl-starred-card-link';
    link.href = `/order/${encodeURIComponent(item.orderId)}/status`;

    // Delegate normal left-clicks to React's hidden original anchor for instant SPA navigation
    link.addEventListener('click', (event) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const targetAnchor = domLinkMap.get(item.orderId);
      if (targetAnchor && document.contains(targetAnchor)) {
        event.preventDefault();
        targetAnchor.click();
      }
    });

    const card = document.createElement('div');
    card.className =
      'box flex-row align-items-center justify-content-between card card-body bg-white btl-starred-card';

    const grow = document.createElement('div');
    grow.className = 'flex-grow-1';
    grow.style.minWidth = '0';

    const row = document.createElement('div');
    row.className = 'd-flex align-items-center justify-content-between';

    const left = document.createElement('div');
    left.className = 'd-flex align-items-center';
    left.style.minWidth = '0';

    if (imageSrc) {
      const img = document.createElement('img');
      img.alt = coffeeName;
      img.className = 'img-fluid mr-2 btl-starred-thumb';
      img.src = imageSrc;
      img.loading = 'lazy';
      left.appendChild(img);
    }

    const textCol = document.createElement('div');
    textCol.style.minWidth = '0';

    const smallWrap = document.createElement('div');
    smallWrap.className = 'small';

    if (vendorName) {
      const vendorEl = document.createElement('div');
      vendorEl.className = 'text-uppercase text-secondary';
      vendorEl.textContent = vendorName;
      smallWrap.appendChild(vendorEl);
    }

    const nameRow = document.createElement('div');
    nameRow.className = 'btl-starred-name-row';

    const strongEl = document.createElement('strong');
    strongEl.textContent = coffeeName;
    nameRow.appendChild(strongEl);

    const heartIcon = document.createElement('i');
    heartIcon.className = 'fa fa-heart btl-inline-heart';
    heartIcon.setAttribute('aria-hidden', 'true');
    heartIcon.title = 'Starred / Loved';
    nameRow.appendChild(heartIcon);

    if (item.orderCount > 1) {
      const repeatBadge = document.createElement('span');
      repeatBadge.className = 'btl-repeat-badge';
      repeatBadge.textContent = `Ordered ${item.orderCount}×`;
      repeatBadge.title = `You ordered this coffee ${item.orderCount} times`;
      nameRow.appendChild(repeatBadge);
    }

    smallWrap.appendChild(nameRow);

    if (item.note || item.brewingMethod) {
      const noteEl = document.createElement('div');
      noteEl.className = 'btl-note-preview';
      const fullTooltip = [item.brewingMethod, item.note]
        .filter(Boolean)
        .join(' — ');
      noteEl.title = fullTooltip;

      if (item.brewingMethod) {
        const methodSpan = document.createElement('span');
        methodSpan.className = 'btl-note-method';
        methodSpan.textContent = `${item.brewingMethod}:`;
        noteEl.appendChild(methodSpan);
      }
      if (item.note) {
        noteEl.appendChild(document.createTextNode(item.note));
      }
      smallWrap.appendChild(noteEl);
    }

    textCol.appendChild(smallWrap);
    left.appendChild(textCol);
    row.appendChild(left);

    if (dateText) {
      const right = document.createElement('div');
      right.className = 'text-right pl-2';
      right.style.flexShrink = '0';

      const lbl = document.createElement('div');
      lbl.className =
        'extra-small text-uppercase font-weight-thin text-nowrap pl-1';
      lbl.textContent = dateLabel || 'Delivered on';

      const val = document.createElement('div');
      val.className = 'small font-weight-bold mb-1';
      val.textContent = dateText;

      right.appendChild(lbl);
      right.appendChild(val);
      row.appendChild(right);
    }

    grow.appendChild(row);
    card.appendChild(grow);

    const chevronWrap = document.createElement('div');
    chevronWrap.className = 'pl-2 pl-md-3 text-secondary box-chevron';
    chevronWrap.appendChild(createChevronSvg());
    card.appendChild(chevronWrap);

    link.appendChild(card);
    col.appendChild(link);
    return col;
  }

  function buildStarredSection(classified, domLinkMap) {
    const section = document.createElement('section');
    section.className = 'panel-section btl-starred-section';
    section.setAttribute(SECTION_ATTR, 'true');

    const header = document.createElement('header');
    header.className =
      'd-flex justify-content-between align-items-center btl-starred-header';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'title-wrapper d-flex btl-starred-title-wrap';

    const heading = document.createElement('h5');
    heading.className = 'title mb-0';

    const heartIcon = document.createElement('i');
    heartIcon.className = 'fa fa-heart btl-heart-heading-icon';
    heartIcon.setAttribute('aria-hidden', 'true');
    heading.appendChild(heartIcon);
    heading.appendChild(document.createTextNode('Starred'));

    titleWrap.appendChild(heading);

    const uniqueCount = classified.uniqueStarredCoffees.length;
    const orderCount = classified.starredOrders.length;

    const countPill = document.createElement('span');
    countPill.className = 'btl-count-pill';
    if (orderCount === 0) {
      countPill.textContent = '0';
    } else if (classified.hasDuplicates) {
      countPill.textContent = `${uniqueCount} coffees · ${orderCount} orders`;
    } else {
      countPill.textContent = `${orderCount} ${orderCount === 1 ? 'coffee' : 'coffees'}`;
    }
    titleWrap.appendChild(countPill);
    header.appendChild(titleWrap);

    if (orderCount > 0) {
      const controls = document.createElement('div');
      controls.className = 'btl-header-controls';

      if (classified.hasDuplicates) {
        const segmented = document.createElement('div');
        segmented.className = 'btl-segmented';
        segmented.setAttribute('role', 'group');
        segmented.setAttribute('aria-label', 'Starred display mode');

        const uniqueBtn = document.createElement('button');
        uniqueBtn.type = 'button';
        uniqueBtn.className = `btl-segmented-btn${state.groupRepeats ? ' is-active' : ''}`;
        uniqueBtn.textContent = `Unique (${uniqueCount})`;
        uniqueBtn.addEventListener('click', () => {
          if (!state.groupRepeats) {
            state.groupRepeats = true;
            writeBoolPref(PREF_GROUP_KEY, true);
            state.lastRenderSignature = '';
            renderOrdersPage();
          }
        });

        const allBtn = document.createElement('button');
        allBtn.type = 'button';
        allBtn.className = `btl-segmented-btn${!state.groupRepeats ? ' is-active' : ''}`;
        allBtn.textContent = `All orders (${orderCount})`;
        allBtn.addEventListener('click', () => {
          if (state.groupRepeats) {
            state.groupRepeats = false;
            writeBoolPref(PREF_GROUP_KEY, false);
            state.lastRenderSignature = '';
            renderOrdersPage();
          }
        });

        segmented.appendChild(uniqueBtn);
        segmented.appendChild(allBtn);
        controls.appendChild(segmented);
      }

      const collapseBtn = document.createElement('button');
      collapseBtn.type = 'button';
      collapseBtn.className = 'btl-collapse-btn';
      collapseBtn.textContent = state.collapsed ? 'Show' : 'Hide';
      collapseBtn.addEventListener('click', () => {
        state.collapsed = !state.collapsed;
        writeBoolPref(PREF_COLLAPSE_KEY, state.collapsed);
        state.lastRenderSignature = '';
        renderOrdersPage();
      });
      controls.appendChild(collapseBtn);

      header.appendChild(controls);
    }

    section.appendChild(header);

    if (!state.collapsed) {
      const aside = document.createElement('aside');
      if (orderCount === 0) {
        const empty = document.createElement('div');
        empty.className = 'btl-empty-card';
        empty.textContent =
          'No starred coffees yet. Open any delivered coffee below and tap the heart ("I loved this") to categorize it here.';
        aside.appendChild(empty);
      } else {
        const itemsToShow = state.groupRepeats
          ? classified.uniqueStarredCoffees
          : classified.starredOrders;

        const grid = document.createElement('div');
        grid.className = 'row';
        for (const item of itemsToShow) {
          grid.appendChild(buildStarredCardCol(item, domLinkMap));
        }
        aside.appendChild(grid);
      }
      section.appendChild(aside);
    }

    return section;
  }

  function updateHistorySection(historySection, classified) {
    const aside = historySection.querySelector('aside');
    if (!aside) return new Map();

    const domLinkMap = new Map();
    let visibleUnstarredCount = 0;

    // 1. Hide starred order columns (CSS-only, never mutating React's tree) and badge disliked ones
    const links = aside.querySelectorAll('a.box-link[href*="/order/"]');
    for (const anchor of links) {
      const orderId = Logic.extractOrderIdFromHref(anchor.getAttribute('href'));
      if (!orderId) continue;

      domLinkMap.set(orderId, anchor);

      const col = anchor.closest('.col-12, .col-md-6') || anchor.parentElement;
      const isStarred = classified.starredOrderIds.has(orderId);
      const isDisliked = classified.dislikedOrderIds.has(orderId);

      if (col) {
        col.classList.toggle(HIDDEN_ORDER_CLASS, isStarred);
      }

      if (!isStarred) {
        visibleUnstarredCount += 1;
      }

      // Add a subtle non-intrusive badge on disliked orders in History
      const existingDislikeBadge = anchor.querySelector('.btl-disliked-badge');
      if (isDisliked && !existingDislikeBadge) {
        const strongEl = anchor.querySelector('strong');
        if (strongEl && strongEl.parentElement) {
          const badge = document.createElement('span');
          badge.className = 'btl-disliked-badge';
          badge.title = "Don't send me this again";
          const icon = document.createElement('i');
          icon.className = 'fa fa-ban';
          icon.setAttribute('aria-hidden', 'true');
          badge.appendChild(icon);
          strongEl.insertAdjacentElement('afterend', badge);
        }
      } else if (!isDisliked && existingDislikeBadge) {
        existingDislikeBadge.remove();
      }
    }

    // 2. Hide year groups whose orders are all starred/hidden
    const rows = aside.querySelectorAll(':scope > div.row');
    for (const row of rows) {
      const cols = Array.from(row.children);
      const hasVisible = cols.some(
        (child) => !child.classList.contains(HIDDEN_ORDER_CLASS)
      );
      row.classList.toggle(HIDDEN_GROUP_CLASS, !hasVisible);

      const prev = row.previousElementSibling;
      if (prev && prev.tagName === 'H5') {
        prev.classList.toggle(HIDDEN_GROUP_CLASS, !hasVisible);
      }
    }

    // 3. Add a subtle sibling pill next to React's History heading (without touching React's text node)
    const titleWrap = historySection.querySelector('header .title-wrapper');
    if (titleWrap) {
      let meta = titleWrap.querySelector('.btl-history-meta');
      if (classified.starredOrders.length > 0) {
        if (!meta) {
          meta = document.createElement('span');
          meta.className = 'btl-history-meta';
          titleWrap.appendChild(meta);
        }
        meta.textContent = `Other orders (${visibleUnstarredCount})`;
      } else if (meta) {
        meta.remove();
      }
    }

    return domLinkMap;
  }

  function updateInProgressSection(inProgressSection, classified) {
    if (!inProgressSection) return;

    const inTransitionById = new Map();
    for (const order of state.inTransitionOrders) {
      if (order && order._id) {
        inTransitionById.set(String(order._id), order);
      }
    }

    const links = inProgressSection.querySelectorAll('a.box-link[href*="/order/"]');
    for (const anchor of links) {
      const orderId = Logic.extractOrderIdFromHref(anchor.getAttribute('href'));
      if (!orderId) continue;

      const order = inTransitionById.get(orderId) || classified.orderById.get(orderId);
      const product = Logic.getOrderProduct(order);
      const productId = product && product._id ? String(product._id) : null;
      const isStarredCoffee =
        Boolean(order && order.product_feedback && order.product_feedback.like === true) ||
        classified.starredOrderIds.has(orderId) ||
        (productId && classified.starredProductIds.has(productId));

      const existingBadge = anchor.querySelector('.btl-inprogress-starred');
      if (isStarredCoffee && !existingBadge) {
        const strongEl = anchor.querySelector('strong');
        if (strongEl) {
          const badge = document.createElement('span');
          badge.className = 'btl-inprogress-starred';
          badge.title = 'Previously starred coffee';
          const icon = document.createElement('i');
          icon.className = 'fa fa-heart text-danger';
          icon.setAttribute('aria-hidden', 'true');
          badge.appendChild(icon);
          badge.appendChild(document.createTextNode('Starred'));
          strongEl.insertAdjacentElement('afterend', badge);
        }
      } else if (!isStarredCoffee && existingBadge) {
        existingBadge.remove();
      }
    }
  }

  function cleanupInjectedUi() {
    state.isApplyingDom = true;
    try {
      const injected = document.querySelectorAll(`[${SECTION_ATTR}]`);
      for (const el of injected) el.remove();

      const metas = document.querySelectorAll(
        '.btl-history-meta, .btl-disliked-badge, .btl-inprogress-starred'
      );
      for (const el of metas) el.remove();

      const hidden = document.querySelectorAll(
        `.${HIDDEN_ORDER_CLASS}, .${HIDDEN_GROUP_CLASS}`
      );
      for (const el of hidden) {
        el.classList.remove(HIDDEN_ORDER_CLASS, HIDDEN_GROUP_CLASS);
      }
    } finally {
      state.isApplyingDom = false;
      state.lastRenderSignature = '';
    }
  }

  function renderOrdersPage() {
    if (!isOrdersPage() || !state.classified) return;

    const { inProgressSection, historySection } = findPanelSections();
    if (!historySection) return;

    const historyLinksCount = historySection.querySelectorAll(
      'aside a.box-link[href*="/order/"]'
    ).length;
    if (historyLinksCount === 0 && state.classified.totalOrders > 0) {
      // Wait until React finishes rendering the order cards
      return;
    }

    const signature = [
      historyLinksCount,
      state.classified.starredOrders.length,
      state.classified.uniqueStarredCoffees.length,
      state.groupRepeats ? 'u' : 'a',
      state.collapsed ? 'c' : 'e',
      Boolean(document.querySelector(`[${SECTION_ATTR}]`)) ? '1' : '0',
    ].join(':');

    if (signature === state.lastRenderSignature) return;

    state.isApplyingDom = true;
    try {
      const domLinkMap = updateHistorySection(historySection, state.classified);
      updateInProgressSection(inProgressSection, state.classified);

      const newSection = buildStarredSection(state.classified, domLinkMap);
      const existingSection = document.querySelector(`[${SECTION_ATTR}]`);

      if (existingSection && existingSection.parentElement === historySection.parentElement) {
        existingSection.replaceWith(newSection);
      } else {
        if (existingSection) existingSection.remove();
        historySection.insertAdjacentElement('beforebegin', newSection);
      }

      state.lastRenderSignature = [
        historyLinksCount,
        state.classified.starredOrders.length,
        state.classified.uniqueStarredCoffees.length,
        state.groupRepeats ? 'u' : 'a',
        state.collapsed ? 'c' : 'e',
        '1',
      ].join(':');
    } finally {
      state.isApplyingDom = false;
    }
  }

  async function syncWithRoute() {
    const currentPath = window.location.pathname;
    const routeChanged = currentPath !== state.lastPathname;
    state.lastPathname = currentPath;

    if (!isOrdersPage()) {
      if (routeChanged) {
        cleanupInjectedUi();
        // Clear cached classification so returning from /order/<id>/status gets fresh star state
        state.classified = null;
      }
      return;
    }

    if (routeChanged) {
      state.lastRenderSignature = '';
      await loadOrdersData(true);
    } else if (!state.classified) {
      await loadOrdersData(false);
    }

    renderOrdersPage();
  }

  function scheduleSync() {
    if (state.isApplyingDom) return;
    if (state.scheduledTimer !== null) return;
    state.scheduledTimer = window.setTimeout(() => {
      state.scheduledTimer = null;
      syncWithRoute();
    }, 60);
  }

  function startObserver() {
    const root = document.getElementById('root') || document.body;
    if (!root) return;

    const observer = new MutationObserver(() => {
      if (state.isApplyingDom) return;
      scheduleSync();
    });

    observer.observe(root, {
      childList: true,
      subtree: true,
    });

    window.addEventListener('popstate', scheduleSync);
    window.addEventListener('focus', () => {
      // Refresh when returning to the tab in case a coffee was starred in another tab
      if (isOrdersPage()) {
        state.lastRenderSignature = '';
        loadOrdersData(true).then(renderOrdersPage);
      }
    });
  }

  startObserver();
  syncWithRoute();
})();
