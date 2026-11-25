(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.BottomlessStarredLogic = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const ORDER_HREF_RE = /\/order\/([^/?#]+)\/status(?:[/?#]|$)/;

  /**
   * Extracts the Bottomless order ID from an anchor href such as
   * "/order/6af638fb7db1c081de5b6604/status".
   */
  function extractOrderIdFromHref(href) {
    if (typeof href !== 'string') return null;
    const match = href.match(ORDER_HREF_RE);
    return match ? match[1] : null;
  }

  /**
   * Reads a named cookie value from a raw document.cookie string.
   */
  function getCookieValue(cookieString, name) {
    if (typeof cookieString !== 'string' || !name) return null;
    const parts = cookieString.split(';');
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      if (key === name) {
        const raw = trimmed.slice(eqIdx + 1).trim();
        try {
          return decodeURIComponent(raw);
        } catch (_) {
          return raw;
        }
      }
    }
    return null;
  }

  /**
   * Resolves the Bottomless auth token from localStorage or cookies,
   * matching Bottomless's own RSAA middleware behavior.
   */
  function getAuthToken(storageValue, cookieString) {
    if (typeof storageValue === 'string' && storageValue.trim()) {
      return storageValue.trim();
    }
    const fromCookie = getCookieValue(cookieString, 'bottomless_access_token');
    if (typeof fromCookie === 'string' && fromCookie.trim()) {
      return fromCookie.trim();
    }
    return null;
  }

  /**
   * Extracts the canonical product object from a Bottomless order record.
   */
  function getOrderProduct(order) {
    if (!order || typeof order !== 'object') return null;
    if (order.subproduct_id && order.subproduct_id.product) {
      return order.subproduct_id.product;
    }
    if (order.product_id && typeof order.product_id === 'object') {
      return order.product_id;
    }
    return null;
  }

  /**
   * Returns a numeric timestamp for sorting orders newest-first.
   */
  function getOrderTimestamp(order) {
    if (!order || typeof order !== 'object') return 0;
    const candidate =
      order.date_arrived ||
      order.date_fulfilled ||
      order.updated_at ||
      order.created_at ||
      null;
    if (!candidate) return 0;
    const ts = Date.parse(candidate);
    return Number.isNaN(ts) ? 0 : ts;
  }

  /**
   * Formats an ISO date string as MM/DD/YYYY to match Bottomless's orders UI.
   */
  function formatOrderDate(isoString) {
    if (!isoString) return '';
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return '';
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${mm}/${dd}/${yyyy}`;
  }

  /**
   * Formats a brewing_method slug (e.g. "pour_over") into readable text.
   */
  function formatBrewingMethod(method) {
    if (typeof method !== 'string' || !method.trim()) return '';
    return method
      .trim()
      .split(/[_\s-]+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
  }

  /**
   * Classifies orders returned by GET /api/orders into starred/disliked indexes
   * and normalized starred items (both per-order and grouped by unique coffee).
   */
  function classifyOrders(orders) {
    const list = Array.isArray(orders) ? orders : [];

    const orderById = new Map();
    const starredOrderIds = new Set();
    const dislikedOrderIds = new Set();
    const starredProductIds = new Set();
    const rawStarredOrders = [];

    for (let i = 0; i < list.length; i++) {
      const order = list[i];
      if (!order || !order._id) continue;

      const orderId = String(order._id);
      orderById.set(orderId, order);

      const feedback = order.product_feedback || null;
      const isLiked = Boolean(feedback && feedback.like === true);
      const isDisliked = Boolean(feedback && feedback.dislike === true);
      const product = getOrderProduct(order);
      const productId = product && product._id ? String(product._id) : orderId;

      if (isLiked) {
        starredOrderIds.add(orderId);
        starredProductIds.add(productId);
        rawStarredOrders.push({
          orderId,
          productId,
          name: (product && product.name) || 'Coffee',
          vendorName: (product && product.vendor_name) || '',
          imageSrc: (product && product.small_image_src) || '',
          dateIso: order.date_arrived || order.date_fulfilled || '',
          dateLabel: order.date_arrived
            ? 'Delivered on'
            : order.date_fulfilled
              ? 'Shipped on'
              : 'Ordered on',
          dateText: formatOrderDate(order.date_arrived || order.date_fulfilled),
          timestamp: getOrderTimestamp(order),
          originalIndex: i,
          note: typeof (feedback && feedback.content) === 'string'
            ? feedback.content.trim()
            : '',
          brewingMethod: formatBrewingMethod(feedback && feedback.brewing_method),
          orderCount: 1,
          allOrderIds: [orderId],
        });
      } else if (isDisliked) {
        dislikedOrderIds.add(orderId);
      }
    }

    // Sort newest first; fall back to API order on tie.
    rawStarredOrders.sort((a, b) => {
      if (b.timestamp !== a.timestamp) return b.timestamp - a.timestamp;
      return a.originalIndex - b.originalIndex;
    });

    // Group repeated coffees by productId while preserving newest-first order.
    const groupedMap = new Map();
    const uniqueStarredCoffees = [];

    for (const item of rawStarredOrders) {
      const existing = groupedMap.get(item.productId);
      if (existing) {
        existing.orderCount += 1;
        existing.allOrderIds.push(item.orderId);
        if (!existing.note && item.note) {
          existing.note = item.note;
        }
        if (!existing.brewingMethod && item.brewingMethod) {
          existing.brewingMethod = item.brewingMethod;
        }
      } else {
        const clone = {
          ...item,
          allOrderIds: [...item.allOrderIds],
        };
        groupedMap.set(item.productId, clone);
        uniqueStarredCoffees.push(clone);
      }
    }

    return {
      totalOrders: list.length,
      orderById,
      starredOrderIds,
      dislikedOrderIds,
      starredProductIds,
      starredOrders: rawStarredOrders,
      uniqueStarredCoffees,
      hasDuplicates: rawStarredOrders.length > uniqueStarredCoffees.length,
    };
  }

  return {
    extractOrderIdFromHref,
    getCookieValue,
    getAuthToken,
    getOrderProduct,
    getOrderTimestamp,
    formatOrderDate,
    formatBrewingMethod,
    classifyOrders,
  };
});
