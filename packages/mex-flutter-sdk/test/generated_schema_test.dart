/// Contract for the committed typegen example (`example/schema.dart`) — the
/// artifact a Flutter app actually copies out of this repo.
///
/// Pins:
///   - D1 wire quirks: snake_case keys → camelCase members, 0/1 booleans.
///   - Tolerant reads: absent keys decode to null, native bools pass through.
///   - PATCH semantics: `toJson()` omits nulls (absent ≠ explicit null) but
///     keeps `false`, and never emits virtual/expansion-only keys.
///   - Field constants mirror the wire names, incl. system fields.
///   - `ApiErrorCodes.all` equals the SDK catalog (no drift, same order).
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:mex_flutter_sdk/mex_flutter_sdk.dart';

import '../example/schema.dart';

void main() {
	group('generated row models (D1 wire quirks)', () {
		test('fromJson maps snake_case keys to camelCase members and 0/1 to bool', () {
			final row = WorkOrders.fromJson(const {
				'id': 'w1',
				'code': 'WO-1',
				'priority': 3,
				'is_billable': 1,
				'is_overdue': 0,
				'meta_note': 'note',
				'assigned_to': 'emp-9',
				'created_at': '2026-01-01T00:00:00Z',
				'total': 42,
			});
			expect(row.id, 'w1');
			expect(row.code, 'WO-1');
			expect(row.priority, 3);
			expect(row.isBillable, isTrue);
			expect(row.isOverdue, isFalse);
			expect(row.metaNote, 'note');
			expect(row.assignedTo, 'emp-9');
			expect(row.createdAt, '2026-01-01T00:00:00Z');
			expect(row.total, 42);
		});

		test('absent keys and nulls decode to null (tolerant reads)', () {
			final row = WorkOrders.fromJson(const {'id': 'w2'});
			expect(row.title, isNull);
			expect(row.status, isNull);
			expect(row.isBillable, isNull);
			expect(row.total, isNull);
			final nulls = WorkOrders.fromJson(const {'id': 'w3', 'is_overdue': null, 'status': null});
			expect(nulls.isOverdue, isNull);
			expect(nulls.status, isNull);
		});

		test('fromJson accepts native bools too (a tolerant decode, not a cast)', () {
			final row = WorkOrders.fromJson(const {'id': 'w4', 'is_billable': true, 'is_overdue': false});
			expect(row.isBillable, isTrue);
			expect(row.isOverdue, isFalse);
		});

		test('toJson omits nulls but keeps false (PATCH-style: absent ≠ falsy)', () {
			const row = WorkOrders(id: 'w1', status: 'draft', isBillable: false);
			final json = row.toJson();
			expect(json, const {'id': 'w1', 'status': 'draft', 'is_billable': false});
			expect(json.containsKey('title'), isFalse);
			expect(json.containsKey('is_overdue'), isFalse);
		});

		test('toJson never emits virtual/expansion-only keys', () {
			const row = WorkOrders(id: 'w1');
			final json = row.toJson();
			expect(json, const {'id': 'w1'});
			expect(json.containsKey('lines'), isFalse);
			expect(json.containsKey('health_label'), isFalse);
		});

		test('a full round-trip preserves every value (toJson is fromJson-invertible)', () {
			const original = WorkOrders(id: 'w9', code: 'C-9', total: 1.5, isOverdue: true, updatedAt: 't');
			final back = WorkOrders.fromJson(original.toJson());
			expect(back.id, original.id);
			expect(back.code, original.code);
			expect(back.total, original.total);
			expect(back.isOverdue, original.isOverdue);
			expect(back.updatedAt, original.updatedAt);
			expect(back.title, isNull);
		});

		test('models are const-constructible', () {
			const a = WorkOrders(id: 'a');
			const b = Contacts(id: 'b', fullName: 'Ada');
			expect(a.id, 'a');
			expect(b.fullName, 'Ada');
		});
	});

	group('generated field constants', () {
		test('mirror the wire names, including system fields', () {
			expect(WorkOrdersFields.id, 'id');
			expect(WorkOrdersFields.isBillable, 'is_billable');
			expect(WorkOrdersFields.metaNote, 'meta_note');
			expect(WorkOrdersFields.createdAt, 'created_at');
			expect(ContactsFields.fullName, 'full_name');
		});
	});

	group('generated ApiErrorCodes', () {
		test('mirrors the SDK catalog exactly (no drift, same order)', () {
			expect(ApiErrorCodes.all, apiErrorCodes);
			expect(ApiErrorCodes.all.length, 12);
			expect(ApiErrorCodes.validationError, 'VALIDATION_ERROR');
			expect(ApiErrorCodes.rateLimitExceeded, 'RATE_LIMIT_EXCEEDED');
			expect(isErrorCode(ApiErrorCodes.internalError), isTrue);
		});
	});
}
