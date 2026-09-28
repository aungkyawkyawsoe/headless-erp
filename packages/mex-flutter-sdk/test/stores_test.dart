/// The path_provider-backed store factories — they must resolve the
/// application-support directory (via the platform interface, faked here)
/// and hand the core a file-backed store that survives a "restart".
library;

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mex_flutter_sdk/mex_flutter_sdk.dart';
import 'package:path_provider_platform_interface/path_provider_platform_interface.dart';

/// Point the app-support directory at a temp dir — `PathProviderPlatform`
/// verifies with the inherited token, so `extends` (not `implements`) is
/// what the interface accepts as a drop-in.
class _FakePathProvider extends PathProviderPlatform {
	_FakePathProvider(this.root);

	final String root;

	@override
	Future<String?> getApplicationSupportPath() async => root;
}

void main() {
	TestWidgetsFlutterBinding.ensureInitialized();

	late Directory root;

	setUp(() {
		root = Directory.systemTemp.createTempSync('headless_erp_stores_test');
		PathProviderPlatform.instance = _FakePathProvider(root.path);
	});

	tearDown(() {
		if (root.existsSync()) root.deleteSync(recursive: true);
	});

	group('openFileQueueStorage', () {
		test('lands in the app-support directory and survives a restart', () async {
			final storage = await openFileQueueStorage();
			storage.set([const QueuedMutation(id: 'a', method: 'POST', path: '/entities/records', createdAt: 1)]);

			final onDisk = File('${root.path}${Platform.pathSeparator}$offlineQueueFileName');
			expect(onDisk.existsSync(), isTrue);

			// A fresh store over the same file — exactly what a relaunch does.
			expect(FileQueueStorage(onDisk).get().single.id, 'a');
		});

		test('honours a custom file name', () async {
			final storage = await openFileQueueStorage(fileName: 'custom_queue.json');
			storage.set([const QueuedMutation(id: 'a', method: 'POST', path: '/entities/records', createdAt: 1)]);

			expect(File('${root.path}${Platform.pathSeparator}custom_queue.json').existsSync(), isTrue);
		});
	});

	group('openFileResponseCacheStorage', () {
		test('lands in the app-support directory and survives a restart', () async {
			final storage = await openFileResponseCacheStorage();
			storage.set([
				const PersistedResponse(
					'GET /entities/records',
					CachedResponse(etag: '"v1"', data: {'id': 'a'}, storedAt: 1, maxAgeS: 60),
				),
			]);
			storage.setFingerprint('fp-1');

			final onDisk = File('${root.path}${Platform.pathSeparator}$responseCacheFileName');
			expect(onDisk.existsSync(), isTrue);

			final reopened = FileResponseCacheStorage(onDisk);
			expect(reopened.getFingerprint(), 'fp-1');
			expect(reopened.get().single.entry.etag, '"v1"');
		});

		test('honours a custom file name', () async {
			final storage = await openFileResponseCacheStorage(fileName: 'custom_cache.json');

			// The store writes on first set() — the file appearing under the
			// custom name proves the factory resolved it.
			storage.set([]);
			expect(File('${root.path}${Platform.pathSeparator}custom_cache.json').existsSync(), isTrue);
		});
	});
}
