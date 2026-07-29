/** @odoo-module */

import { PosStore } from "@point_of_sale/app/store/pos_store";
import { PosOrder } from "@point_of_sale/app/models/pos_order";
import { PosOrderline } from "@point_of_sale/app/models/pos_order_line";
import { patch } from "@web/core/utils/patch";
import { Orderline } from "@point_of_sale/app/generic_components/orderline/orderline";
import { ToppingPopup } from "@bi_pos_product_toppings/js/ToppingPopup";
import { formatCurrency } from "@point_of_sale/app/models/utils/currency";

if (Orderline.props && Orderline.props.line && Orderline.props.line.shape) {
    Orderline.props.line.shape.toppingsData = { type: Array, optional: true };
    Orderline.props.line.shape.topping_uuid = { type: String, optional: true };
}

patch(PosStore.prototype, {
    async _processData(loadedData) {
        await super._processData(...arguments);
        let self = this;
		self.prod_toppings = loadedData['topping.groups'] || [];
		self.toppings_by_id = loadedData['toppings_by_id'] || [];
		self.topping_group_by_id = loadedData['topping_group_by_id'] || [];
    },
    async addLineToCurrentOrder(vals, opts = {}, configure = true) {
		let line = await super.addLineToCurrentOrder(vals, opts, configure);
		if(this.config.activate_toppings){
            console.log("Toppings enabled!", "add_topping_default:", this.config.add_topping_default, "configure:", configure);
            if(this.config.add_topping_default){
			    this._addDefaultToppings();
            } else if (configure) {
                let order = this.get_order();
                let orderline = line || (order ? order.get_selected_orderline() : null);
                let product = orderline ? orderline.get_product() : null;
                console.log("Product added:", product ? product.display_name : "none", "topping_ids:", product ? product.topping_ids : "none");
                if (product && product.topping_ids) {
                    let prod_list = [];
                    let arr = product.topping_ids;
                    if (!Array.isArray(arr)) {
                        arr = [arr];
                    }
                    console.log("Toppings array:", arr);
                    arr.forEach((prod) => {
                        let top_prod = typeof prod === 'object' ? prod : this.models['product.product'].get(prod);
                        if (top_prod && !prod_list.find(p => p.id === top_prod.id)){
                            prod_list.push(top_prod);
                        }
                    });
                    console.log("Final Toppings List:", prod_list);
                    if (prod_list.length > 0 && this.env.services.dialog) {
                        this.env.services.dialog.add(ToppingPopup, {'toppings':prod_list});
                    }
                }
            }
		}
        return line;
	},
	_addDefaultToppings(){
		if(this.config.activate_toppings && this.config.add_topping_default){
            let order = this.get_order();
            if (!order) return;
			let orderline = order.get_selected_orderline();
            if (!orderline) return;
			let prod = orderline.get_product();
			let old_rate = orderline.get_unit_price();

			let arr = prod.topping_ids;
			let aa = arr.filter((item,index) => arr.indexOf(item) === index);
			orderline.set_line_topping_ids(aa);
			let details  = orderline.getToppingDetails();
			let total_arr = details.map(item => item.total);
			let sum = total_arr.reduce((a, b) => a + b, 0) + old_rate;
			orderline.price_type = "manual";
			orderline.set_unit_price(sum);
			orderline.price_manually_set = true;
		} 
	}
});

patch(PosOrderline.prototype, {
	setup() {
        super.setup(...arguments);
        this.line_toppings = this.line_toppings || [];
		this.line_topping_ids = this.line_topping_ids || [];
		this.toppings_total = this.toppings_total || 0;
		this.toppingdata = this.toppingdata || [];
    },

    getDisplayData() {
        let toppingsData = JSON.parse(JSON.stringify(this.get_toppingsData() || []));
        for (let t of toppingsData) {
            t.formatted_rate = formatCurrency(t.rate, this.currency);
            t.formatted_total = formatCurrency(t.total, this.currency);
        }
        return {
            ...super.getDisplayData(),
            toppingsData: toppingsData,
            topping_uuid: this.uuid,
        };
    },

	set_line_toppings(line_toppings){
		this.order_id.assert_editable();
		this.line_toppings = line_toppings;
	},

	clone() {
        const orderline = super.clone(...arguments);
        orderline.line_topping_ids = this.line_topping_ids || [];
        return orderline;
    },
	get_line_toppings(){
		return this.line_toppings;
	},

	set_line_topping_ids(line_topping_ids){
		this.order_id.assert_editable();
		this.line_topping_ids = line_topping_ids;
	},

	get_line_topping_ids(){
		return this.line_topping_ids;
	},

	set_toppings_total(toppings_total){
		this.toppings_total = toppings_total;
	},

	get_toppings_total(){
		return this.toppings_total;
	},
		
	init_from_JSON(json){
		super.init_from_JSON(...arguments);
		this.line_toppings = json.line_toppings || [];
		let restored_topping_ids = [];
		if (json.line_topping_ids) {
			for (let t of json.line_topping_ids) {
				let p_id = (typeof t === 'object') ? t.id : t;
				let prod = this.models['product.product'].get(p_id);
				if (prod) restored_topping_ids.push(prod);
			}
		}
		this.line_topping_ids = restored_topping_ids;
		this.toppings_total = json.toppings_total || 0;
		this.toppingdata = json.toppingdata || [];
	},

	export_as_JSON(){
		const json = super.export_as_JSON(...arguments);
		json.line_toppings = this.getToppingDetails() || [];
		json.toppingdata = this.toppingdata || [];
		json.line_topping_ids = (this.line_topping_ids || []).map(t => typeof t === 'object' ? t.id : t);
		json.toppings_total = this.get_toppings_total() || 0;
		return json;
	},

	export_for_printing() {
		const json = super.export_for_printing(...arguments);
		json.toppingdata = this.toppingdata || [];
		json.line_topping_ids = (this.line_topping_ids || []).map(t => typeof t === 'object' ? t.id : t);
		json.toppings_total = this.toppings_total || 0;
		return json;
	},

  	deleteLine(ev){
  		let toppings = this.get_line_topping_ids();
  		let y = toppings.filter(value => (typeof value === 'object' ? value.id : value) != ev.id);
  		this.set_line_topping_ids(y);
  		let details  = this.getToppingDetails();
        let total_arr = details.map(item => item.total);
        let sum = total_arr.reduce((a, b) => a + b, 0);
        let base_price = this.get_product().get_price(this.order_id?.pricelist_id || null, this.get_quantity());
  		this.price_type = "manual";
  		this.set_unit_price(base_price + sum);
        this.update({ price_unit: base_price + sum });
  		this.price_manually_set = true;
        if (this.order_id && typeof this.order_id.recomputeOrderData === 'function') {
            this.order_id.recomputeOrderData();
        }
  	},
	increaseToppingQty(ev) {
		let toppings = this.get_line_topping_ids();
		let product = this.models['product.product'].get(ev.id);
		if (product) {
			toppings.push(product);
			this.set_line_topping_ids(toppings);
		}
		let details  = this.getToppingDetails();
		let total_arr = details.map(item => item.total);
		let sum = total_arr.reduce((a, b) => a + b, 0);
		let base_price = this.get_product().get_price(this.order_id?.pricelist_id || null, this.get_quantity());
		this.price_type = "manual";
		this.set_unit_price(base_price + sum);
		this.update({ price_unit: base_price + sum });
		this.price_manually_set = true;
		if (this.order_id && typeof this.order_id.recomputeOrderData === 'function') {
			this.order_id.recomputeOrderData();
		}
	},

	decreaseToppingQty(ev) {
		let toppings = this.get_line_topping_ids();
		let index = toppings.findIndex(value => (typeof value === 'object' ? value.id : value) == ev.id);
		if (index !== -1) {
			toppings.splice(index, 1);
		}
		this.set_line_topping_ids(toppings);
		let details  = this.getToppingDetails();
		let total_arr = details.map(item => item.total);
		let sum = total_arr.reduce((a, b) => a + b, 0);
		let base_price = this.get_product().get_price(this.order_id?.pricelist_id || null, this.get_quantity());
		this.price_type = "manual";
		this.set_unit_price(base_price + sum);
		this.update({ price_unit: base_price + sum });
		this.price_manually_set = true;
		if (this.order_id && typeof this.order_id.recomputeOrderData === 'function') {
			this.order_id.recomputeOrderData();
		}
	},

	get_toppingsData(){
		return this.toppingdata || [];
	},

	getToppingDetails(){
  		let self = this;
  		let topping_ids = this.line_topping_ids;
  		let prod_list = [];
  		let prod_dict = {};
  		let t_total = 0;
  		topping_ids.forEach(function (prod) {
  			let product = (typeof prod === 'object') ? prod : self.models['product.product'].get(prod);
  			if(product){
                let price = product.get_price(self.order_id?.pricelist_id || null, 1);
  				t_total += price;
                let p_id = product.id;
  				if(p_id in prod_dict){
  					let old_qty = prod_dict[p_id]['qty'] + 1;
  
  					prod_dict[p_id] = {
  						'id' : product.id,
  						'name' : product.display_name,
  						'uom' : self.models['uom.uom'].get(product.uom_id[0])?.name || '',
  						'qty' : old_qty,
  						'rate' : price,
  						'total' : price * old_qty,
  					};
  				}else{
  					prod_dict[p_id] = {
  						'id' : product.id,
  						'name' : product.display_name,
  						'uom' : self.models['uom.uom'].get(product.uom_id[0])?.name || '',
  						'qty' : 1,
  						'rate' : price,
  						'total' : price ,
  					};
  				}
  			}
  		}); 
		self.set_toppings_total(t_total);
		prod_list = Object.values(prod_dict);
		this.toppingdata = prod_list;
		return prod_list;
	},

});
