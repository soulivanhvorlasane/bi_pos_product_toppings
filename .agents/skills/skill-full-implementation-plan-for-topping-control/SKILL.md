---
name: skill-full-implementation-plan-for-topping-control
description: A complete zero-to-hero guide on implementing POS Topping Inventory Control in Odoo 18, covering UI quantity adjustments, JS payload serialization, backend data parsing, and stock move generation.
---

# Implementing POS Topping Inventory Control in Odoo 18

This skill documents the complete architecture and implementation steps for adding inventory-tracked toppings (modifiers) to the Point of Sale in Odoo 18.

## 1. Product Setup Requirements
For stock to deduct correctly when sold via the POS, toppings must be set up properly in Odoo:
- **Product Type**: Storable Product (`type = 'consu'`, `is_storable = True` in Odoo 18).
- **Inventory Tracking**: By Quantity.
- **Category**: Assigned to a specific POS category for toppings if necessary.

## 2. Frontend UI (Javascript)
To allow cashiers to add toppings and adjust quantities, you need a custom popup (e.g., `ToppingPopup.xml` and `ToppingPopup.js`). 
- Maintain a state (e.g., `this.state.quantities`) mapping product IDs to their selected quantities.
- Use `+` and `-` buttons in the UI to mutate this state.
- Upon confirming the popup, calculate the `total` prices and attach the selected toppings to the current `pos.order.line`.

## 3. Handling Odoo 18 Data Serialization
**Crucial Odoo 18 Change**: Older versions of Odoo used `export_as_JSON()` to send data to the backend. Odoo 18 completely removes `export_as_JSON()` for API synchronization and uses `serialize(options = {})` instead.

To send custom data (like a JSON string of selected toppings) to the Python backend, you must patch the `serialize` method on the frontend model.

```javascript
import { PosOrderline } from "@point_of_sale/app/models/pos_order_line";
import { patch } from "@web/core/utils/patch";

patch(PosOrderline.prototype, {
    serialize(options = {}) {
        const json = super.serialize(...arguments);
        
        // Prevent frontend-only UI variables from reaching the backend ORM payload
        if (!options.orm) {
            json.line_toppings = this.getToppingDetails() || [];
            json.toppingdata = this.toppingdata || [];
        }
        
        // Stringify the topping data so it passes through the ORM without schema issues
        json.topping_data = JSON.stringify(this.toppingdata || []);
        
        return json;
    }
});
```
*Note: If you send frontend-only objects in `json` while `options.orm` is true, Odoo 18 will raise an **"Invalid field"** server error and the order will get stuck in IndexedDB.*

## 4. Backend Processing (`pos.order`)
When the POS synchronizes the order, the `sync_from_ui` method calls `_process_order`. You must intercept this method to parse the stringified JSON and dynamically append the topping lines to the order payload.

```python
from odoo import models, api
import json

class PosOrder(models.Model):
    _inherit = 'pos.order'

    @api.model
    def _process_order(self, order, existing_order):
        odr = order
        new_lines = []
        
        for lines in odr.get('lines', []):
            if isinstance(lines, (list, tuple)) and len(lines) > 2:
                # 1. Pop out any stray frontend variables to prevent ORM crashes
                lines[2].pop('line_toppings', None)
                lines[2].pop('toppingdata', None)
                
                # 2. Extract and parse the stringified topping payload
                topping_data_str = lines[2].get('topping_data', '[]')
                toppingdata = []
                try:
                    if topping_data_str:
                        toppingdata = json.loads(topping_data_str)
                except Exception:
                    pass
                
                # 3. Create Odoo order line definitions for each topping
                for product in toppingdata:
                    vals = [0, 0, {
                        'qty': product.get('qty', 1),
                        'price_unit': 0, # Depending on pricing logic
                        'price_subtotal': 0,
                        'price_subtotal_incl': 0,
                        'product_id': product.get('id', False),
                        'tax_ids': [[6, False, []]], # Apply appropriate taxes
                        'full_product_name': product.get('name', "-"),
                    }]
                    new_lines.append(vals)
        
        # 4. Append the new topping lines to the original payload
        order['lines'].extend(new_lines)
        
        # 5. Let the base Odoo method create the order and the stock pickings
        return super(PosOrder, self)._process_order(order, existing_order)
```
Because the toppings are injected into `order['lines']` with a valid `product_id` and non-zero `qty`, Odoo's base POS logic (`_create_order_picking`) will automatically recognize them as Storable products and generate the corresponding `stock.move` and `stock.picking` records!

## 5. Usage Analytics & Reporting
To track topping consumption, create a Pivot/Graph view based on the `pos.order.line` model.

1. In `pos.order.line`, add a related boolean field to determine if the product is a topping:
```python
is_topping = fields.Boolean(related='product_id.is_topping', store=True)
```
2. Create an XML action that forces a domain filter: `[('is_topping', '=', True)]`.
3. Provide Pivot and Graph views grouped by `product_id` to show total quantities consumed across all orders.
