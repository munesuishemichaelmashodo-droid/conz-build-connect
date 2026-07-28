import { o as __toESM } from "../_runtime.mjs";
import { l as require_react_dom, u as require_react } from "./@floating-ui/react-dom+[...].mjs";
//#region node_modules/@react-leaflet/core/lib/attribution.js
var import_react_dom = /* @__PURE__ */ __toESM(require_react_dom(), 1);
var import_react = /* @__PURE__ */ __toESM(require_react(), 1);
function useAttribution(map, attribution) {
	const attributionRef = (0, import_react.useRef)(attribution);
	(0, import_react.useEffect)(function updateAttribution() {
		if (attribution !== attributionRef.current && map.attributionControl != null) {
			if (attributionRef.current != null) map.attributionControl.removeAttribution(attributionRef.current);
			if (attribution != null) map.attributionControl.addAttribution(attribution);
		}
		attributionRef.current = attribution;
	}, [map, attribution]);
}
function createLeafletContext(map) {
	return Object.freeze({
		__version: 1,
		map
	});
}
function extendContext(source, extra) {
	return Object.freeze({
		...source,
		...extra
	});
}
var LeafletContext = (0, import_react.createContext)(null);
function useLeafletContext() {
	const context = (0, import_react.use)(LeafletContext);
	if (context == null) throw new Error("No context provided: useLeafletContext() can only be used in a descendant of <MapContainer>");
	return context;
}
//#endregion
//#region node_modules/@react-leaflet/core/lib/component.js
function createContainerComponent(useElement) {
	function ContainerComponent(props, forwardedRef) {
		const { instance, context } = useElement(props).current;
		(0, import_react.useImperativeHandle)(forwardedRef, () => instance);
		const { children } = props;
		return children == null ? null : /*#__PURE__*/ import_react.createElement(LeafletContext, { value: context }, children);
	}
	return /*#__PURE__*/ (0, import_react.forwardRef)(ContainerComponent);
}
function createDivOverlayComponent(useElement) {
	function OverlayComponent(props, forwardedRef) {
		const [isOpen, setOpen] = (0, import_react.useState)(false);
		const { instance } = useElement(props, setOpen).current;
		(0, import_react.useImperativeHandle)(forwardedRef, () => instance);
		(0, import_react.useEffect)(function updateOverlay() {
			if (isOpen) instance.update();
		}, [
			instance,
			isOpen,
			props.children
		]);
		const contentNode = instance._contentNode;
		return contentNode ? /*#__PURE__*/ (0, import_react_dom.createPortal)(props.children, contentNode) : null;
	}
	return /*#__PURE__*/ (0, import_react.forwardRef)(OverlayComponent);
}
function createLeafComponent(useElement) {
	function LeafComponent(props, forwardedRef) {
		const { instance } = useElement(props).current;
		(0, import_react.useImperativeHandle)(forwardedRef, () => instance);
		return null;
	}
	return /*#__PURE__*/ (0, import_react.forwardRef)(LeafComponent);
}
//#endregion
//#region node_modules/@react-leaflet/core/lib/events.js
function useEventHandlers(element, eventHandlers) {
	const eventHandlersRef = (0, import_react.useRef)(void 0);
	(0, import_react.useEffect)(function addEventHandlers() {
		if (eventHandlers != null) element.instance.on(eventHandlers);
		eventHandlersRef.current = eventHandlers;
		return function removeEventHandlers() {
			if (eventHandlersRef.current != null) element.instance.off(eventHandlersRef.current);
			eventHandlersRef.current = null;
		};
	}, [element, eventHandlers]);
}
//#endregion
//#region node_modules/@react-leaflet/core/lib/pane.js
function withPane(props, context) {
	const pane = props.pane ?? context.pane;
	return pane ? {
		...props,
		pane
	} : props;
}
//#endregion
//#region node_modules/@react-leaflet/core/lib/div-overlay.js
function createDivOverlayHook(useElement, useLifecycle) {
	return function useDivOverlay(props, setOpen) {
		const context = useLeafletContext();
		const elementRef = useElement(withPane(props, context), context);
		useAttribution(context.map, props.attribution);
		useEventHandlers(elementRef.current, props.eventHandlers);
		useLifecycle(elementRef.current, context, props, setOpen);
		return elementRef;
	};
}
//#endregion
//#region node_modules/@react-leaflet/core/lib/element.js
function createElementObject(instance, context, container) {
	return Object.freeze({
		instance,
		context,
		container
	});
}
function createElementHook(createElement, updateElement) {
	if (updateElement == null) return function useImmutableLeafletElement(props, context) {
		const elementRef = (0, import_react.useRef)(void 0);
		if (!elementRef.current) elementRef.current = createElement(props, context);
		return elementRef;
	};
	return function useMutableLeafletElement(props, context) {
		const elementRef = (0, import_react.useRef)(void 0);
		if (!elementRef.current) elementRef.current = createElement(props, context);
		const propsRef = (0, import_react.useRef)(props);
		const { instance } = elementRef.current;
		(0, import_react.useEffect)(function updateElementProps() {
			if (propsRef.current !== props) {
				updateElement(instance, props, propsRef.current);
				propsRef.current = props;
			}
		}, [
			instance,
			props,
			updateElement
		]);
		return elementRef;
	};
}
//#endregion
//#region node_modules/@react-leaflet/core/lib/layer.js
function useLayerLifecycle(element, context) {
	(0, import_react.useEffect)(function addLayer() {
		(context.layerContainer ?? context.map).addLayer(element.instance);
		return function removeLayer() {
			context.layerContainer?.removeLayer(element.instance);
			context.map.removeLayer(element.instance);
		};
	}, [context, element]);
}
function createLayerHook(useElement) {
	return function useLayer(props) {
		const context = useLeafletContext();
		const elementRef = useElement(withPane(props, context), context);
		useAttribution(context.map, props.attribution);
		useEventHandlers(elementRef.current, props.eventHandlers);
		useLayerLifecycle(elementRef.current, context);
		return elementRef;
	};
}
//#endregion
//#region node_modules/@react-leaflet/core/lib/path.js
function usePathOptions(element, props) {
	const optionsRef = (0, import_react.useRef)(void 0);
	(0, import_react.useEffect)(function updatePathOptions() {
		if (props.pathOptions !== optionsRef.current) {
			const options = props.pathOptions ?? {};
			element.instance.setStyle(options);
			optionsRef.current = options;
		}
	}, [element, props]);
}
function createPathHook(useElement) {
	return function usePath(props) {
		const context = useLeafletContext();
		const elementRef = useElement(withPane(props, context), context);
		useEventHandlers(elementRef.current, props.eventHandlers);
		useLayerLifecycle(elementRef.current, context);
		usePathOptions(elementRef.current, props);
		return elementRef;
	};
}
//#endregion
//#region node_modules/@react-leaflet/core/lib/generic.js
function createLayerComponent(createElement, updateElement) {
	return createContainerComponent(createLayerHook(createElementHook(createElement, updateElement)));
}
function createOverlayComponent(createElement, useLifecycle) {
	return createDivOverlayComponent(createDivOverlayHook(createElementHook(createElement), useLifecycle));
}
function createPathComponent(createElement, updateElement) {
	return createContainerComponent(createPathHook(createElementHook(createElement, updateElement)));
}
function createTileLayerComponent(createElement, updateElement) {
	return createLeafComponent(createLayerHook(createElementHook(createElement, updateElement)));
}
//#endregion
//#region node_modules/@react-leaflet/core/lib/grid-layer.js
function updateGridLayer(layer, props, prevProps) {
	const { opacity, zIndex } = props;
	if (opacity != null && opacity !== prevProps.opacity) layer.setOpacity(opacity);
	if (zIndex != null && zIndex !== prevProps.zIndex) layer.setZIndex(zIndex);
}
//#endregion
export { createTileLayerComponent as a, LeafletContext as c, useLeafletContext as d, createPathComponent as i, createLeafletContext as l, createLayerComponent as n, createElementObject as o, createOverlayComponent as r, withPane as s, updateGridLayer as t, extendContext as u };
