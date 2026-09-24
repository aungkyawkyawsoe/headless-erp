import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Design-system tokens/utilities come in through index.css (which imports
// `@mmbix/design-system/theme.css` and scans the DS sources it uses) — the
// prebuilt DS stylesheet is deliberately NOT imported: it is a second,
// largely-dead copy of every DS utility that bloats the critical CSS.
import './index.css';
import App from './app/App';
import { ErrorBoundary } from './app/error-boundary';
import { armSlowTimerWatchdog } from './shared/platform/slow-timer-watchdog';
import { applyInitialTheme } from './shared/platform/theme';

// Dev-only: name the call site of any timer handler Chrome reports as a long task
// (`[Violation] 'setTimeout' handler took Nms` carries no stack of its own). Dead code
// in a production build, so the wrapper never ships.
if (import.meta.env.DEV) armSlowTimerWatchdog();

// Apply the active scheme before the first paint (mirrors the index.html head script).
applyInitialTheme();

createRoot(document.getElementById('root')!).render(
	<StrictMode>
		<ErrorBoundary>
			<App />
		</ErrorBoundary>
	</StrictMode>,
);
