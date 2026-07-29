/** @odoo-module */

import { Component } from "@odoo/owl";
import { _t } from "@web/core/l10n/translation";
import { useService } from "@web/core/utils/hooks";
import { usePos } from "@point_of_sale/app/store/pos_hook";
import { Dialog } from "@web/core/dialog/dialog";

export class ToppingPopup extends Component {
    static template = "bi_pos_product_toppings.ToppingPopup";
    static components = { Dialog };
    static props = {
        toppings: { type: Array, optional: true },
        close: Function,
    };

    setup() {
        super.setup();
        this.pos = usePos();
    }
   
   	imageUrl(product) {
        return `/web/image?model=product.product&field=image_128&id=${product.id}&write_date=${product.write_date}&unique=1`;
    }
    get pricelist() {
        const current_order = this.pos.get_order();
        if (current_order) {
            return current_order.pricelist;
        }
        return this.pos.default_pricelist;
    }
    price(product) {
        const formattedUnitPrice = this.env.utils.formatCurrency(
            product.get_price(this.pricelist, 1),
            'Product Price'
        );
        if (product.to_weight) {
            return `${formattedUnitPrice}/${
                this.pos.models['uom.uom'].get(product.uom_id[0]).name
            }`;
        } else {
            return formattedUnitPrice;
        }
    }
   	get toppingProducts(){
		return this.props.toppings;
	}

	add_product_toppings(ev){
		let product = ev;
		let order = this.pos.get_order();
		let orderline = order.get_selected_orderline();
		let old_recs = orderline.get_line_topping_ids();
		old_recs.push(product);
		orderline.set_line_topping_ids(old_recs);
		let details  = orderline.getToppingDetails();
		let total_arr = details.map(item => item.total);
		let sum = total_arr.reduce((a, b) => a + b, 0);
        
        let base_price = orderline.get_product().get_price(orderline.order_id?.pricelist_id || null, orderline.get_quantity());
        orderline.price_type = "manual";
		orderline.set_unit_price(base_price + sum);
        orderline.update({ price_unit: base_price + sum });
		orderline.price_manually_set = true;
        if (orderline.order_id && typeof orderline.order_id.recomputeOrderData === 'function') {
            orderline.order_id.recomputeOrderData();
        }
	}

    cancel() {
        this.props.close();
    }
}
