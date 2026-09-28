/// Items API — the write-protocol options a caller can attach to a mutation.
/// 1:1 Dart port of `test/items.test.ts`.
///
/// The one that needs pinning is `ack`: a guard WARNING the server already
/// showed the caller (the MRO same-day duplicate requisition) is confirmed by a
/// header, so an unacknowledged write must carry NO such header — an always-on
/// header would silently disarm every guard the server registers.
library;

import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:mex_flutter_sdk/mex_flutter_sdk.dart';

void main() {
	group('items api — guard-warning acknowledgement', () {
		/// A request double that records every options object it is handed.
		({List<RequestOptions> calls, ItemsApi items}) capture() {
			final calls = <RequestOptions>[];
			Future<RequestResult<T>> request<T>(
				String path, [
				RequestOptions options = const RequestOptions(),
			]) async {
				calls.add(options);
				return RequestResult<T>({'id': 'row-1'} as T);
			}

			final items = ItemsApi('orders', request, () => defaultPageSizePolicy);
			return (calls: calls, items: items);
		}

		test('sends the acknowledgement header ONLY when a token is passed', () async {
			final captured = capture();

			await captured.items.create({'note': 'plain'});
			await captured.items.create(
				{'note': 'confirmed'},
				const CreateOptions(ack: 'requisition-duplicate'),
			);

			expect(captured.calls[0].headers, isNull);
			expect(captured.calls[1].headers, {writeAckHeader: 'requisition-duplicate'});
			// The token never leaks into the record itself.
			expect(jsonEncode(captured.calls[1].body), isNot(contains('requisition-duplicate')));
		});

		test('passes the acknowledgement through on an update too', () async {
			final captured = capture();

			await captured.items.update(
				'row-1',
				{'note': 'x'},
				const UpdateOptions(ack: 'requisition-duplicate'),
			);
			expect(captured.calls[0].headers, {writeAckHeader: 'requisition-duplicate'});
			expect(captured.calls[0].method, 'PUT');
		});
	});
}
