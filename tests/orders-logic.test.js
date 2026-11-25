const test = require('node:test');
const assert = require('node:assert/strict');
const Logic = require('../src/orders-logic.js');

test('extractOrderIdFromHref parses Bottomless order status URLs', () => {
  assert.equal(
    Logic.extractOrderIdFromHref('/order/6af638fb7db1c081de5b6604/status'),
    '6af638fb7db1c081de5b6604'
  );
  assert.equal(
    Logic.extractOrderIdFromHref(
      'https://www.bottomless.com/order/6a14c922cc4150a9f27e87ad/status?ref=orders'
    ),
    '6a14c922cc4150a9f27e87ad'
  );
  assert.equal(Logic.extractOrderIdFromHref('/products/peru'), null);
  assert.equal(Logic.extractOrderIdFromHref(null), null);
});

test('getAuthToken prefers localStorage and falls back to cookie', () => {
  assert.equal(
    Logic.getAuthToken('token-from-ls', 'bottomless_access_token=token-from-cookie'),
    'token-from-ls'
  );
  assert.equal(
    Logic.getAuthToken('', 'foo=bar; bottomless_access_token=abc%20123; baz=1'),
    'abc 123'
  );
  assert.equal(Logic.getAuthToken(null, 'other=val'), null);
});

test('classifyOrders separates starred, disliked, and unstarred orders and groups repeats', () => {
  const sampleOrders = [
    {
      _id: 'ord-1',
      date_arrived: '2026-11-23T14:00:00.000Z',
      subproduct_id: {
        product: {
          _id: 'prod-unstarred',
          name: 'Peru',
          vendor_name: 'Sun Bear',
          small_image_src: 'https://example.com/peru.png',
        },
      },
    },
    {
      _id: 'ord-2',
      date_arrived: '2026-05-29T14:25:00.000Z',
      subproduct_id: {
        product: {
          _id: 'prod-gesha',
          name: 'Pedro Garcia Gesha',
          vendor_name: "Blanchard's Coffee",
          small_image_src: 'https://example.com/gesha.png',
        },
      },
      product_feedback: {
        like: true,
        dislike: false,
        brewing_method: 'pour_over',
        content: '24g into 380ml. Delicious!',
      },
    },
    {
      _id: 'ord-3',
      date_arrived: '2026-08-12T12:00:00.000Z',
      subproduct_id: {
        product: {
          _id: 'prod-gesha',
          name: 'Pedro Garcia Gesha',
          vendor_name: "Blanchard's Coffee",
          small_image_src: 'https://example.com/gesha.png',
        },
      },
      product_feedback: {
        like: true,
        dislike: false,
        brewing_method: 'pour_over',
        content: '24g into 380ml. Delicious!',
      },
    },
    {
      _id: 'ord-4',
      date_arrived: '2026-04-01T12:00:00.000Z',
      subproduct_id: {
        product: {
          _id: 'prod-disliked',
          name: 'Dark Roast Blend',
          vendor_name: 'Roaster X',
        },
      },
      product_feedback: {
        like: false,
        dislike: true,
      },
    },
  ];

  const result = Logic.classifyOrders(sampleOrders);

  assert.equal(result.totalOrders, 4);
  assert.equal(result.starredOrderIds.size, 2);
  assert.equal(result.starredOrderIds.has('ord-2'), true);
  assert.equal(result.starredOrderIds.has('ord-3'), true);
  assert.equal(result.dislikedOrderIds.size, 1);
  assert.equal(result.dislikedOrderIds.has('ord-4'), true);
  assert.equal(result.starredProductIds.has('prod-gesha'), true);
  assert.equal(result.hasDuplicates, true);

  // Sorted newest first
  assert.equal(result.starredOrders.length, 2);
  assert.equal(result.starredOrders[0].orderId, 'ord-3');
  assert.equal(result.starredOrders[1].orderId, 'ord-2');

  // Grouped unique coffees
  assert.equal(result.uniqueStarredCoffees.length, 1);
  assert.equal(result.uniqueStarredCoffees[0].orderId, 'ord-3');
  assert.equal(result.uniqueStarredCoffees[0].orderCount, 2);
  assert.equal(result.uniqueStarredCoffees[0].brewingMethod, 'Pour Over');
  assert.equal(result.uniqueStarredCoffees[0].note, '24g into 380ml. Delicious!');
});

test('classifyOrders handles empty arrays, missing subproduct_id, and one-off product_id fallback', () => {
  const empty = Logic.classifyOrders([]);
  assert.equal(empty.totalOrders, 0);
  assert.equal(empty.starredOrders.length, 0);
  assert.equal(empty.uniqueStarredCoffees.length, 0);
  assert.equal(empty.hasDuplicates, false);

  const oneOff = Logic.classifyOrders([
    {
      _id: 'oneoff-1',
      date_fulfilled: '2026-03-10T10:00:00.000Z',
      product_id: {
        _id: 'prod-oneoff',
        name: 'Special Micro-Lot',
        vendor_name: 'Small Roaster',
      },
      product_feedback: { like: true },
    },
  ]);

  assert.equal(oneOff.starredOrders.length, 1);
  assert.equal(oneOff.starredOrders[0].name, 'Special Micro-Lot');
  assert.equal(oneOff.starredOrders[0].vendorName, 'Small Roaster');
  assert.equal(oneOff.starredOrders[0].dateLabel, 'Shipped on');
  assert.equal(oneOff.starredOrders[0].dateText, '03/10/2026');
  assert.equal(oneOff.hasDuplicates, false);
});

