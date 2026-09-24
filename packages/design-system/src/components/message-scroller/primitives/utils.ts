// Vendored from @shadcn/react message-scroller (MIT).
import * as React from 'react';

function useLatest<T>(value: T) {
	const ref = React.useRef(value);

	// Update after commit so refs are never written during render.
	React.useEffect(() => {
		ref.current = value;
	}, [value]);

	return ref;
}

export { useLatest };
