/* Which basis this row charges on: the row's own choice, else the shop's. */
function rowMode(row, type) {
    var f = row ? row.querySelector('[name="making_mode"]') : null;
    var m = f ? f.value : '';
    if (m === 'flat' || m === 'percent') return m;
    return type === 'gold' ? GOLD_MAKING_MODE : (type === 'silver' ? SILVER_MAKING_MODE : 'none');
}

/* Metal: weight x metal rate + making charges. No separate unit price.
   percent -> % of metal value · flat -> Rs/g (gold) or Rs/10g (silver). */
function fmt(n) { return Number(n || 0).toLocaleString('en-IN', {minimumFractionDigits:2, maximumFractionDigits:2}); }
function calculateTotals() { return window.InvoicePricing ? window.InvoicePricing.schedule() : Promise.resolve(false); }

function toggleMetalFields(select) {
    var row = select.closest('.item-row'),
        isMetal = select.value === 'gold' || select.value === 'silver',
        label = row.querySelector('.making-label'),
        making = row.querySelector('[name="making_charges"]'),
        weight = row.querySelector('[name="weight"]'),
        modeField = row.querySelector('[name="making_mode"]');
    var weighed = row.dataset.weighed === '1';
    // Weighed goods are sold by the gram — the quantity IS the weight, so
    // there is no "weight per unit" box for them.
    weight.closest('.item-field').hidden = !(isMetal && !weighed);
    weight.required = isMetal && !weighed;
    if (!isMetal) weight.value = '';
    else if (weighed) weight.value = '1';
    var mode = rowMode(row, select.value);
    if (modeField) modeField.value = isMetal ? mode : 'none';
    making.closest('.item-field').style.display = (isMetal && SHOW_MAKING) ? '' : 'none';
    if (!isMetal) making.value = '';
    // metal rows have no unit price — it is weight x rate, shown read-only
    var price = row.querySelector('.price-field');
    if (price) {
        price.readOnly = isMetal;
        price.required = !isMetal;
        price.placeholder = isMetal ? 'Auto' : 'Price/Unit';
        price.title = isMetal ? 'Computed: weight (g) x metal rate' : '';
        if (isMetal) price.classList.add('computed');
        else price.classList.remove('computed');
    }
    var hintHTML = ' <span class="rate-hint"></span>';
    if (select.value === 'gold') label.innerHTML = (mode === 'flat' ? 'Making ₹/g' : 'Making %') + hintHTML;
    else if (select.value === 'silver') label.innerHTML = (mode === 'percent' ? 'Making %' : 'Making ₹/10g') + hintHTML;
    var hint = row.querySelector('.rate-hint');
    if (hint) hint.textContent = select.value === 'gold' ? '· Au ₹' + fmt(GOLD_RATE) + '/g'
        : select.value === 'silver' ? '· Ag ₹' + fmt(SILVER_RATE) + '/g' : '';
}

function bindRow(row) {
    if (row.dataset.bound) return;
    row.dataset.bound = '1';
    row.querySelector('select[name="item_type"]').addEventListener('change', function() {
        row.querySelector('[name=making_mode]').value = '';
        toggleMetalFields(this); calculateTotals();
    });
    ['quantity', 'unit_price', 'weight', 'making_charges'].forEach(function(n) {
        row.querySelector('[name="' + n + '"]').addEventListener('input', calculateTotals);
    });
}

function escapeAttribute(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
        return {'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char];
    });
}
function rowHTML(values) {
    values = values || {};
    var field = function(label, input, extra) {
        return '<div class="item-field ' + (extra || '') + '"><label>' + label + input + '</label></div>';
    };
    var opts = ['gold', 'silver', 'general'].map(function(t) {
        return '<option value="' + t + '"' + (values.type === t ? ' selected' : '') + '>' + t.charAt(0).toUpperCase() + t.slice(1) + '</option>';
    }).join('');
    return field('Item description', '<input type="text" name="description" placeholder="Name or description" maxlength="200" required value="' + escapeAttribute(values.desc) + '">', 'description-field') +
        field('Metal / item type', '<select name="item_type">' + opts + '</select>') +
        field('Quantity <span class="quantity-unit">(pieces)</span>', '<input type="number" inputmode="decimal" name="quantity" step="any" min="0.001" value="1" required>') +
        field('Weight per piece (g)', '<input type="number" inputmode="decimal" name="weight" step="0.001" min="0.001" class="metal-field" value="' + escapeAttribute(values.weight) + '">') +
        '<div class="item-field"><label class="making-label">Making %</label><input type="number" aria-label="Making charge" inputmode="decimal" name="making_charges" placeholder="Shop default" step="0.01" min="0" class="making-field"><input type="hidden" name="making_mode" value="' + escapeAttribute(values.mode) + '"></div>' +
        field('Price per unit (₹)', '<input type="number" inputmode="decimal" name="unit_price" class="price-field" step="0.01" min="0" required value="' + escapeAttribute(values.price) + '">') +
        '<input type="hidden" name="product_code" value="' + escapeAttribute(values.code) + '">' +
        field('Line total (₹)', '<input type="text" class="line-total" readonly value="0.00">') +
        '<button type="button" class="btn btn-ghost item-remove" aria-label="Remove item" onclick="removeItem(this)">Remove</button><div class="line-note"></div>';
}
function newRow(values, weighed) {
    var row = document.createElement('div'); row.className = 'item-row';
    row.innerHTML = rowHTML(values);
    row.querySelector('[name=quantity]').closest('.item-field').classList.add('quantity-field');
    if (weighed) row.dataset.weighed = '1';
    document.getElementById('items-container').appendChild(row);
    var more = document.createElement('details'); more.className = 'item-more';
    more.open = !values || !values.code || !matchMedia('(max-width:640px)').matches;
    var summary = document.createElement('summary'); summary.textContent = 'Weight, making & price'; more.appendChild(summary);
    var fields = document.createElement('div'); fields.className = 'item-detail-fields'; more.appendChild(fields);
    Array.from(row.querySelectorAll('.item-field')).forEach(function(field) { if (!field.classList.contains('description-field') && !field.querySelector('[name=quantity]')) fields.appendChild(field); });
    row.appendChild(more);
    bindRow(row); toggleMetalFields(row.querySelector('[name="item_type"]'));
    row.querySelector('.quantity-unit').textContent = weighed ? '(grams)' : '(pieces)';
    return row;
}

function addItem() {
    var row = newRow({});
    row.querySelector('[name="description"]').focus();
    calculateTotals();
    document.getElementById('invoice-form').dispatchEvent(new Event('input', {bubbles:true}));
}

function addProductByCode(scanned) {
    var code = (scanned || document.getElementById('product-code').value).trim();
    // QR payload is "barcode|name|weight|price" — product code is the first segment
    if (code.indexOf('|') !== -1) code = code.split('|')[0].trim();
    if (!code) return;
    fetch('/products/scan/' + encodeURIComponent(code))
        .then(function(r) {
            if (r.redirected || !r.ok) throw new Error('Sign in again or check your connection.');
            return r.json();
        })
        .then(function(data) {
            if (data.success) {
                addProductToForm(data.product);
                document.getElementById('product-code').value = '';
                sayScan('Added ' + data.product.name + ' (' + code + ')');
            } else {
                sayScan('No product with code "' + code + '" — check the tag.');
                showToast('Product not found. Check the code and try again.', 'warning');
            }
        })
        .catch(function() {
            /* An expired session redirects to the login page, so r.json()
               throws — without this the scanner just went quiet. */
            sayScan('Could not look up "' + code + '" — still signed in?');
        });
}

function addProductToForm(product) {
    var weighed = product.unit === 'g';
    var available = weighed ? product.stock_weight : product.stock_quantity;
    if (available <= 0) { sayScan('This item is out of stock.'); return; }
    var rows = document.querySelectorAll('.item-row');
    if (rows.length === 1 && !rows[0].querySelector('[name="description"]').value.trim()) rows[0].remove();
    var row = newRow({ desc:product.name, type:product.item_type,
        weight:weighed ? '' : product.weight_per_unit, price:product.unit_price,
        code:product.barcode || '', mode:product.making_mode || '' }, weighed);
    row.querySelector('[name="quantity"]').max = available;
    row.querySelector('[name="item_type"]').disabled = false;
    if (product.unit === 'g') {
        var qinput = row.querySelector('[name="quantity"]');
        qinput.placeholder = 'Qty (grams)';
        qinput.title = 'Sold by weight — enter grams. In stock: ' +
            (product.stock_weight || 0) + ' g';
        sayScan('Weighed item: enter grams (' + (product.stock_weight || 0) + ' g in stock)');
    }
    calculateTotals();
    document.getElementById('invoice-form').dispatchEvent(new Event('input', {bubbles:true}));
}

function removeItem(button) {
    button.closest('.item-row').remove();
    if (!document.querySelector('.item-row')) newRow({});
    calculateTotals();
    document.getElementById('invoice-form').dispatchEvent(new Event('input', {bubbles:true}));
}

document.getElementById('payment_type').addEventListener('change', function() {
    var show = this.value === 'partial';
    document.getElementById('partial_payment_section').style.display = show ? 'block' : 'none';
    document.getElementById('partial_amount').required = show;
    if (!show) document.getElementById('partial_amount').value = '';
    calculateTotals();
});
document.getElementById('partial_amount').addEventListener('input', calculateTotals);
document.getElementById('discount_type').addEventListener('change', calculateTotals);
document.getElementById('discount_value').addEventListener('input', calculateTotals);
document.getElementById('exchange_metal').addEventListener('change', function() {
    if (this.value === 'none') document.getElementById('exchange_amount').value = 0;
    calculateTotals();
});
document.getElementById('exchange_amount').addEventListener('input', calculateTotals);
document.getElementById('product-code').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); addProductByCode(); }
});
document.addEventListener('DOMContentLoaded', function() {
    newRow({});
    document.querySelectorAll('.item-row').forEach(function(row) {
        bindRow(row);
        toggleMetalFields(row.querySelector('select[name="item_type"]'));
    });
    initClientSearch();
    initQuickCustomer();
    initInvoicePricing();
    initBillDraft();
    initMobileBilling();
    calculateTotals();
    var scannedCode = new URLSearchParams(location.search).get('product_code');
    if (scannedCode && document.getElementById('draft-notice').hidden) addProductByCode(scannedCode);
});

/* ---------- client search ---------- */
function initClientSearch() {
    var box = document.getElementById('client-search'),
        sel = document.getElementById('client_id'),
        hint = document.getElementById('client-hint');
    var gstinBox = document.getElementById('client_gstin'),
        gstinHint = document.getElementById('gstin-hint');
    function showHint() {
        var opt = sel.options[sel.selectedIndex];
        if (opt) opt.hidden = false;
        hint.textContent = (opt && opt.value)
            ? 'Outstanding balance: ₹' + (opt.dataset.balance || '0.00') : '';
        if (gstinBox && opt) {
            var g = (opt.dataset.gstin || '').trim();
            gstinBox.value = g;
            gstinHint.textContent = g ? 'Customer GSTIN. You can edit it for this bill.'
                : 'Optional. Add a GSTIN if the customer needs it on the bill.';
        }
    }
    sel.addEventListener('change', showHint); showHint();
    box.addEventListener('input', function() {
        var q = box.value.trim().toLowerCase(), first = null, visible = 0;
        Array.prototype.forEach.call(sel.options, function(o) {
            if (!o.value) return;
            var hit = !q || (o.dataset.search || o.text.toLowerCase()).indexOf(q) !== -1;
            o.hidden = !hit && o.value !== sel.value;
            if (hit) { visible++; if (!first) first = o; }
        });
        hint.textContent = q ? visible + ' match' + (visible === 1 ? '' : 'es') + ' — Enter to pick first' : '';
        box.dataset.first = first ? first.value : '';
        if (!q) showHint();
    });
    box.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (!box.dataset.first) return;
            sel.value = box.dataset.first; showHint();
            sel.dispatchEvent(new Event('change', {bubbles:true}));
        }
    });
}


function sayScan(message) { var node = document.getElementById("scan-msg"); if(node) node.textContent = message; }
