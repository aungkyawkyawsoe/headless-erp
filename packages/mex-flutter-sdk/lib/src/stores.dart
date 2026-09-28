/// path_provider-backed defaults for the core's injectable storage seams —
/// both stores live under the application-support directory ("persistent,
/// backed up, not visible to the user": internal storage on Android,
/// Application Support on iOS/macOS). The offline write queue and the
/// offline-reads cache both survive app restarts from here; the reads cache
/// only ever holds bodies the server blessed with `X-Offline-Max-Age`, and
/// [TokenStorage]'s logout clears them (the core handles both).
///
/// ```dart
/// final erp = HeadlessErpClient(HeadlessErpOptions(
///   baseUrl: 'https://api.example.com',
///   tokenStorage: secureStorage,
///   offlineQueue: OfflineQueue.create(OfflineQueueOptions(
///     storage: await openFileQueueStorage(),
///   )),
/// ));
/// ```
library;

import 'dart:io';

import 'package:path_provider/path_provider.dart';

import 'conditional_cache.dart';
import 'offline.dart';

/// Default file name for the offline write queue's device store.
const offlineQueueFileName = 'headless_erp_offline_queue.json';

/// Default file name for the offline-reads cache.
const responseCacheFileName = 'headless_erp_read_cache.json';

/// Open the default file-backed offline-queue store (app-support directory).
Future<FileQueueStorage> openFileQueueStorage({String fileName = offlineQueueFileName}) async =>
	FileQueueStorage(await _storeFile(fileName));

/// Open the default file-backed offline-reads store (app-support directory).
Future<FileResponseCacheStorage> openFileResponseCacheStorage({
	String fileName = responseCacheFileName,
}) async =>
	FileResponseCacheStorage(await _storeFile(fileName));

Future<File> _storeFile(String fileName) async {
	final dir = await getApplicationSupportDirectory();
	return File('${dir.path}${Platform.pathSeparator}$fileName');
}
