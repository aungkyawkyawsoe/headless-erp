/// FlutterSecureTokenStorage tests — the real `FlutterSecureStorage` against
/// the plugin's official in-memory test platform (`setMockInitialValues`),
/// so mirror hydration, persistence and failure handling run end to end
/// without a platform channel.
library;

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_secure_storage/test/test_flutter_secure_storage_platform.dart';
import 'package:flutter_secure_storage_platform_interface/flutter_secure_storage_platform_interface.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mex_flutter_sdk/mex_flutter_sdk.dart';

/// A platform whose Keychain/Keystore is broken — every operation throws.
class _AngryPlatform extends TestFlutterSecureStoragePlatform {
	_AngryPlatform() : super({});

	@override
	Future<String?> read({required String key, required Map<String, String> options}) async {
		throw StateError('keystore unavailable');
	}

	@override
	Future<void> write({required String key, required String value, required Map<String, String> options}) async {
		throw StateError('keystore unavailable');
	}
}

void main() {
	TestWidgetsFlutterBinding.ensureInitialized();

	group('FlutterSecureTokenStorage', () {
		test('init() hydrates the mirror from the secure store', () async {
			FlutterSecureStorage.setMockInitialValues({FlutterSecureTokenStorage.tokenKey: 'stored-token'});
			final storage = FlutterSecureTokenStorage();

			expect(storage.get(), isNull); // nothing is known before hydration
			await storage.init();
			expect(storage.get(), 'stored-token');
		});

		test('init() hydrates the refresh slot too', () async {
			FlutterSecureStorage.setMockInitialValues({
				FlutterSecureTokenStorage.tokenKey: 'stored-token',
				FlutterSecureTokenStorage.refreshTokenKey: 'stored-refresh',
			});
			final storage = FlutterSecureTokenStorage();

			expect(storage.getRefresh(), isNull);
			await storage.init();
			expect(storage.get(), 'stored-token');
			expect(storage.getRefresh(), 'stored-refresh');
		});

		test('set()/clear() apply to the mirror synchronously and persist through the store', () async {
			final values = <String, String>{};
			FlutterSecureStorage.setMockInitialValues(values);
			final storage = FlutterSecureTokenStorage();
			await storage.init();

			storage.set('fresh-token');
			expect(storage.get(), 'fresh-token'); // synchronous read-back
			await pumpEventQueue(); // let the async persist land
			expect(values[FlutterSecureTokenStorage.tokenKey], 'fresh-token');

			storage.clear();
			expect(storage.get(), isNull);
			await pumpEventQueue();
			expect(values.containsKey(FlutterSecureTokenStorage.tokenKey), isFalse);
		});

		test('setRefresh persists its own slot; setRefresh(null) removes it; clear() drops both', () async {
			final values = <String, String>{};
			FlutterSecureStorage.setMockInitialValues(values);
			final storage = FlutterSecureTokenStorage();
			await storage.init();

			storage.set('tok');
			storage.setRefresh('refresh-1');
			expect(storage.getRefresh(), 'refresh-1'); // synchronous read-back
			await pumpEventQueue(); // let the async persists land
			expect(values[FlutterSecureTokenStorage.tokenKey], 'tok');
			expect(values[FlutterSecureTokenStorage.refreshTokenKey], 'refresh-1');

			storage.setRefresh(null);
			expect(storage.getRefresh(), isNull);
			await pumpEventQueue();
			expect(values.containsKey(FlutterSecureTokenStorage.refreshTokenKey), isFalse);

			storage.setRefresh('refresh-2');
			storage.clear();
			expect(storage.get(), isNull);
			expect(storage.getRefresh(), isNull);
			await pumpEventQueue();
			expect(values.containsKey(FlutterSecureTokenStorage.tokenKey), isFalse);
			expect(values.containsKey(FlutterSecureTokenStorage.refreshTokenKey), isFalse);
		});

		test('a set() that races ahead of init() is authoritative (never clobbered)', () async {
			FlutterSecureStorage.setMockInitialValues({FlutterSecureTokenStorage.tokenKey: 'stored-token'});
			final storage = FlutterSecureTokenStorage();

			storage.set('raced-token');
			await storage.init(); // hydration must not overwrite the fresh session
			expect(storage.get(), 'raced-token');
		});

		test('init() is once-only — it never resurrects a token cleared afterwards', () async {
			FlutterSecureStorage.setMockInitialValues({FlutterSecureTokenStorage.tokenKey: 'stored-token'});
			final storage = FlutterSecureTokenStorage();
			await storage.init();
			expect(storage.get(), 'stored-token');

			storage.clear();
			await storage.init(); // second call is a no-op
			expect(storage.get(), isNull);
		});

		test('a failed device write surfaces via onPersistError but keeps the session running', () async {
			FlutterSecureStoragePlatform.instance = _AngryPlatform();
			final errors = <Object>[];
			final storage = FlutterSecureTokenStorage(onPersistError: errors.add);

			storage.set('token');
			await pumpEventQueue();
			expect(errors.single, isA<StateError>());
			expect(storage.get(), 'token'); // in-memory session unaffected
		});

		test('a failed hydration surfaces via onPersistError and leaves the session logged out', () async {
			FlutterSecureStoragePlatform.instance = _AngryPlatform();
			final errors = <Object>[];
			final storage = FlutterSecureTokenStorage(onPersistError: errors.add);

			await storage.init();
			expect(errors.single, isA<StateError>());
			expect(storage.get(), isNull);
		});
	});
}
