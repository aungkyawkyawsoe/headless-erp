# Field Validation (v0.7)

Declare validation rules directly in the field schema. 12 rule types, enforced server-side on every create/update.

## Rule Types

| Rule          | Config               | Description                               |
| ------------- | -------------------- | ----------------------------------------- |
| `required`    | `message?`           | Value must not be empty                   |
| `min`         | `value`              | Numeric minimum                           |
| `max`         | `value`              | Numeric maximum                           |
| `min_length`  | `value`              | String minimum length                     |
| `max_length`  | `value`              | String maximum length                     |
| `regex`       | `pattern`            | Must match regex                          |
| `email`       | `message?`           | Must be a valid email                     |
| `url`         | `message?`           | Must be a valid URL                       |
| `unique`      | `message?`           | Must be unique in collection (DB-checked) |
| `in`          | `values`             | Must be one of the listed values          |
| `expression`  | `formula`, `message` | Custom Boolean expression                 |
| `required_if` | `field`, `value`     | Required when another field equals value  |

## Example Schema

```json
{
	"name": "Employees",
	"fields": [
		{
			"name": "email",
			"type": "email",
			"required": true,
			"validation": [
				{ "type": "required", "message": "Email is mandatory" },
				{ "type": "email", "message": "Invalid email format" },
				{ "type": "unique", "message": "Email already in use" }
			]
		},
		{
			"name": "age",
			"type": "integer",
			"validation": [
				{ "type": "min", "value": 18, "message": "Must be 18+" },
				{ "type": "max", "value": 65 }
			]
		},
		{
			"name": "code",
			"type": "text",
			"validation": [{ "type": "regex", "pattern": "^[A-Z]{2}-\\d{4}$", "message": "Format: AB-1234" }]
		},
		{
			"name": "department",
			"type": "select",
			"options": ["sales", "engineering", "hr"],
			"validation": [{ "type": "in", "values": ["sales", "engineering", "hr"] }]
		},
		{
			"name": "termination_reason",
			"type": "text",
			"validation": [{ "type": "required_if", "field": "status", "value": "terminated" }]
		},
		{
			"name": "bonus_percent",
			"type": "percent",
			"validation": [{ "type": "expression", "formula": "value >= 0 && value <= 30", "message": "Bonus must be 0-30%" }]
		}
	]
}
```

## Expression Rules

The `expression` rule evaluates against `value` (the field's value) and `data` (all fields):

```json
{
	"type": "expression",
	"formula": "value <= data.credit_limit",
	"message": "Amount exceeds credit limit"
}
```

Expressions use the [safe expression engine](default-expressions.md#supported-expression-syntax) — arithmetic, comparisons (`== != < <= > >=`, also `===`/`!==`), logical operators (`&& || !`), and whitelisted functions (`Math.*`, `NOW()`, `parseInt`, etc.). No `eval`/`new Function` (workerd-compatible). Access other fields via `data.<field>`.

## Error Response

```json
{
	"success": false,
	"error": "\"age\": Must be 18+; \"email\": Email is mandatory",
	"code": "VALIDATION_ERROR"
}
```

Status: `400`.

## Enforcement Points

- `POST /api/entities/:collection` (create)
- `PUT /api/entities/:collection/:id` (update)
- `POST /api/bulk/:collection` (each item)
- CSV import (each row; failures reported per-row)

## When to Use

- Email/URL/phone format checks
- Range validation on numbers
- Cross-field conditions (`required_if`)
- Complex business rules without writing code
