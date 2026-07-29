/** @odoo-module */

import { usePos } from "@point_of_sale/app/store/pos_hook";
import { ProductScreen } from "@point_of_sale/app/screens/product_screen/product_screen";
import { ControlButtons } from "@point_of_sale/app/screens/product_screen/control_buttons/control_buttons";
import { Component } from "@odoo/owl";
import { AlertDialog } from "@web/core/confirmation_dialog/confirmation_dialog";
import { ToppingPopup } from "@bi_pos_product_toppings/js/ToppingPopup";
import { _t } from "@web/core/l10n/translation";

export class ToppingsButton extends Component {
    static template = "bi_pos_product_toppings.ToppingsButton";

    setup() {
    	super.setup();
        this.pos = usePos();
    }

    async onClick() {
		let self = this;
		var order = this.pos.get_order();
		var orderlines = order.get_orderlines();
		if (orderlines.length === 0) {
			this.env.services.dialog.add(AlertDialog,{
				'title': _t('Empty Order'),
				'body': _t('There must be at least one product in your order before applying order type.'),
			});
			return;
		}
		else{
			var prod_list = [];
			let selected_orderline = order.get_selected_orderline();					
			if(selected_orderline && selected_orderline.get_product() && selected_orderline.get_product().topping_ids){
				let arr = selected_orderline.get_product().topping_ids;
                if (!Array.isArray(arr)) {
                    arr = [arr];
                }
				arr.forEach(function (prod) {
					var top_prod = typeof prod === 'object' ? prod : self.pos.models['product.product'].get(prod);
					if (top_prod && !prod_list.find(p => p.id === top_prod.id)){
						prod_list.push(top_prod);
					}
                });
			}
            
            this.env.services.dialog.add(ToppingPopup, {'toppings':prod_list});
		}
	}
}

ControlButtons.components = {
    ...ControlButtons.components,
    ToppingsButton,
};
