from odoo import api, fields, models, _
import json


class ProductTemplate(models.Model):
	_inherit = 'product.template'

	is_topping = fields.Boolean(string="Is Topping")
	topping_group_ids = fields.Many2many("topping.groups",string="Topping Groups")
	topping_ids = fields.Many2many("product.product",'rel_prod_tmpl_db','p1','p2',string="Toppings",domain=[("is_topping","=",True)])


class ProductProduct(models.Model):
	_inherit = 'product.product'

	topping_group_ids = fields.Many2many(related='product_tmpl_id.topping_group_ids', readonly=False)
	topping_ids = fields.Many2many(related='product_tmpl_id.topping_ids', readonly=False)

	@api.onchange('topping_group_ids')
	def onchange_topping_group_ids(self):
		for rec in self.topping_group_ids:
			self.topping_ids = rec.topping_ids.ids

	@api.model
	def _load_pos_data_fields(self, config_id):
		fields = super()._load_pos_data_fields(config_id)
		fields.extend(['is_topping', 'topping_group_ids', 'topping_ids', 'qty_available', 'uom_id'])
		return fields
		

class ToppingGroups(models.Model):
	_name = 'topping.groups'
	_description = "Topping Groups"
	_inherit = ['pos.load.mixin']

	name = fields.Char('Name', required=True)
	topping_ids = fields.Many2many("product.product",'rel_prod_tg_db','tg_id','prod_id',string="Toppings",domain=[("is_topping","=",True)])

	@api.model
	def _load_pos_data_domain(self, data):
		return []

	@api.model
	def _load_pos_data_fields(self, config_id):
		return ['id', 'name', 'topping_ids']


class PosCategory(models.Model):
	_inherit = 'pos.category'

	topping_ids = fields.Many2many("product.product",'rel_prod_categ_db','categ_id','prod_id',string="Toppings",domain=[("is_topping","=",True)])

	@api.model
	def _load_pos_data_fields(self, config_id):
		fields = super()._load_pos_data_fields(config_id)
		fields.extend(['topping_ids'])
		return fields


class PosConfig(models.Model):
	_inherit = 'pos.config'

	activate_toppings = fields.Boolean('Enable Product Toppings')
	add_topping_default = fields.Boolean('Add toppings on product add')


class ResConfigSettings(models.TransientModel):
	_inherit = 'res.config.settings'

	activate_toppings = fields.Boolean(related='pos_config_id.activate_toppings',readonly=False)
	add_topping_default = fields.Boolean(related='pos_config_id.add_topping_default',readonly=False)


class pos_order(models.Model):
	_inherit = 'pos.order'

	@api.model
	def _process_order(self, order, existing_order):
		import uuid
		odr = order
		new_lines = []
		for lines in odr.get('lines', []):
			if isinstance(lines, (list, tuple)) and len(lines) > 2:
				# Remove frontend-only fields to prevent "Invalid field" errors from stuck payloads
				lines[2].pop('line_toppings', None)
				lines[2].pop('toppingdata', None)
				lines[2].pop('toppings_total', None)
				
				# Convert Many2many to ORM command
				if 'line_topping_ids' in lines[2] and isinstance(lines[2]['line_topping_ids'], list):
					lines[2]['line_topping_ids'] = [[6, False, lines[2]['line_topping_ids']]]
				
				toppingdata = []
				topping_data_str = lines[2].get('topping_data', '[]')
				try:
					if topping_data_str:
						toppingdata = json.loads(topping_data_str)
				except Exception:
					pass
				if not toppingdata:
					toppingdata = lines[2].get('toppingdata', [])

				combo_list = []
				if toppingdata:
					for product in toppingdata:
						vals =  [0, 0, {
							'qty': product.get('qty',1),
							'price_unit': 0,
							'price_subtotal': 0,
							'price_subtotal_incl': 0,
							'discount': 0,
							'product_id': product.get('id',False),
							'tax_ids': [[6, False, []]],
							'full_product_name': product.get('name',"-"),
							'name': product.get('name',"-"),
							'uuid': str(uuid.uuid4()),
						}]
						new_lines.append(vals)
		order['lines'].extend(new_lines)
		return super(pos_order, self)._process_order(order, existing_order)

	def _process_preparation_changes(self, cancelled=False, general_note=None, note_history=None, **kwargs):
		self.ensure_one()
		flag_change = False
		sound = False

		pdis_order = self.env['pos_preparation_display.order'].search(
			[('pos_order_id', '=', self.id)]
		)

		if general_note is not None:
			if not pdis_order and general_note:
				pdis_order = self.env['pos_preparation_display.order'].create({
					'pos_order_id': self.id,
					'general_note': general_note,
				})
				flag_change = True
			elif pdis_order and pdis_order.general_note != general_note:
				pdis_order.general_note = general_note
				flag_change = True

		pdis_lines = pdis_order.preparation_display_order_line_ids
		pdis_ticket = False
		quantity_data = {}
		category_ids = set()

		# If cancelled flag, we flag all lines as cancelled
		if cancelled:
			for line in pdis_lines:
				line.product_cancelled = line.product_quantity
				category_ids.update(line.product_id.pos_categ_ids.ids)
			return {'change': True, 'sound': sound, 'category_ids': category_ids}

		# create a dictionary with the key as a tuple of product_id, internal_note and attribute_value_ids
		for pdis_line in pdis_lines:
			key = (pdis_line.product_id.id, pdis_line.internal_note or '', json.dumps(pdis_line.attribute_value_ids.ids), json.dumps(pdis_line.line_topping_ids.ids))
			line_qty = pdis_line.product_quantity - pdis_line.product_cancelled
			if not quantity_data.get(key):
				quantity_data[key] = {
					'attribute_value_ids': pdis_line.attribute_value_ids.ids,
					'line_topping_ids': pdis_line.line_topping_ids.ids,
					'note': pdis_line.internal_note or '',
					'product_id': pdis_line.product_id.id,
					'display': line_qty,
					'order': 0,
				}
			else:
				quantity_data[key]['display'] += line_qty

		for line in self.lines.filtered(lambda li: not li.skip_change):
			line_note = line.note or ''
			key = (line.product_id.id, line_note, json.dumps(line.attribute_value_ids.ids), json.dumps(line.line_topping_ids.ids))

			if not quantity_data.get(key):
				quantity_data[key] = {
					'attribute_value_ids': line.attribute_value_ids.ids,
					'line_topping_ids': line.line_topping_ids.ids,
					'note': line_note or '',
					'product_id': line.product_id.id,
					'display': 0,
					'order': line.qty,
				}
			else:
				quantity_data[key]['order'] += line.qty

		# Update quantity_data with note_history
		if note_history:
			for line in pdis_lines[::-1]:
				product_id = str(line.product_id.id)
				for note in note_history.get(product_id, []):
					if line.internal_note == note['old'] and note['qty'] > 0 and line.product_quantity <= note['qty'] - note.get('used_qty', 0):
						if not note.get('used_qty'):
							note['used_qty'] = line.product_quantity
						else:
							note['used_qty'] += line.product_quantity

						key = (line.product_id.id, line.internal_note or '', json.dumps(line.attribute_value_ids.ids), json.dumps(line.line_topping_ids.ids))
						key_new = (line.product_id.id, note['new'] or '', json.dumps(line.attribute_value_ids.ids), json.dumps(line.line_topping_ids.ids))

						line.internal_note = note['new']
						flag_change = True
						category_ids.update(line.product_id.pos_categ_ids.ids)

						# Merge the two lines, so that if the quantity was changed it's also applied
						old_quantity = quantity_data.pop(key, None)
						quantity_data[key_new]["display"] += old_quantity["display"]
						quantity_data[key_new]["order"] += old_quantity["order"]

		# Check if pos_order have new lines or if some lines have more quantity than before
		if any([quantities['order'] > quantities['display'] for quantities in quantity_data.values()]):
			is_not_splitted_order = not self.env.context.get("is_splited_order")
			flag_change = is_not_splitted_order
			sound = is_not_splitted_order
			pdis_ticket = self.env['pos_preparation_display.order'].create({
				'displayed': is_not_splitted_order,
				'pos_order_id': self.id,
				'pos_config_id': self.config_id.id,
			})
			pdis_order = pdis_ticket

		product_ids = self.env['product.product'].browse([data['product_id'] for data in quantity_data.values()])
		for key, data in quantity_data.items():
			product_id = data['product_id']
			product = product_ids.filtered(lambda p: p.id == product_id)
			if data['order'] > data['display']:
				missing_qty = data['order'] - data['display']
				filtered_lines = self.lines.filtered(lambda li: li.product_id.id == product_id and (li.note or '') == data['note'] and li.attribute_value_ids.ids == data['attribute_value_ids'])
				line_qty = 0
				for line in filtered_lines:

					if line_qty >= missing_qty:
						break
					if line.qty > 0:
						flag_change = True
						qty_to_add = min(line.qty, missing_qty - line_qty)
						category_ids.update(product.pos_categ_ids.ids)
						self.env['pos_preparation_display.orderline'].create({
							'todo': True,
							'internal_note': (line.note or ''),
							'attribute_value_ids': line.attribute_value_ids.ids,
							'line_topping_ids': line.line_topping_ids.ids,
							'product_id': product_id,
							'product_quantity': qty_to_add,
							'preparation_display_order_id': pdis_order.id,
						})
						line_qty += qty_to_add
			elif data['order'] < data['display']:
				qty_to_cancel = data['display'] - data['order']
				for line in pdis_lines.filtered(lambda li: li.product_id.id == product_id and li.internal_note == data['note'] and li.attribute_value_ids.ids == data['attribute_value_ids']):
					flag_change = True
					line_qty = 0
					pdis_qty = line.product_quantity - line.product_cancelled

					if qty_to_cancel == 0:
						break

					if pdis_qty > qty_to_cancel:
						line.product_cancelled += qty_to_cancel
						qty_to_cancel = 0
					elif pdis_qty <= qty_to_cancel:
						line.product_cancelled += pdis_qty
						qty_to_cancel -= pdis_qty

		return {'change': flag_change, 'sound': sound, 'category_ids': category_ids}


class POSSession(models.Model):
	_inherit = 'pos.session'

	def _load_pos_data_models(self, config_id):
		models = super()._load_pos_data_models(config_id)
		models.append('topping.groups')
		return models


class pos_order_line(models.Model):
	_inherit = 'pos.order.line'

	line_topping_ids = fields.Many2many("product.product",string="Product Toppings")
	topping_data = fields.Text(string="Topping Data JSON")

	@api.model
	def _load_pos_data_fields(self, config_id):
		fields = super()._load_pos_data_fields(config_id)
		fields.extend(['line_topping_ids', 'topping_data'])
		return fields