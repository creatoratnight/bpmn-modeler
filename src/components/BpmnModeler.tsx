import React, { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import BpmnModeler from 'bpmn-js/lib/Modeler';
import BpmnColorPickerModule from 'bpmn-js-color-picker';
import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css';


const BPMNModelerComponent = forwardRef(({ xml, viewPosition, onModelChange, onViewPositionChange }, ref) => {
    const modelerRef = useRef(null);
    const modelerInstance = useRef(null);

    useEffect(() => {
        modelerInstance.current = new BpmnModeler({
            container: modelerRef.current,
            keyboard: {
                bindTo: window,
            },
            additionalModules: [
                BpmnColorPickerModule
            ]
        });

        modelerInstance.current.importXML(xml).then(() => {
            if (viewPosition) {
                setViewPosition(modelerInstance.current);
            }
        });

        modelerInstance.current.on('canvas.viewbox.changed', () => {
            const viewbox = getViewPosition(modelerInstance.current);
            if (viewPosition !== viewbox) {
                onViewPositionChange(viewbox);
            }
        });

        modelerInstance.current.on(['commandStack.changed'], async () => {
            try {
                const { xml } = await modelerInstance.current.saveXML({ format: true });
                onModelChange(xml);
            } catch (err) {
                console.error('Error saving XML', err);
            }
        });

        return () => {
            modelerInstance.current.destroy();
        };
    }, []);

    useImperativeHandle(ref, () => ({
        saveSVG: () => {
            return modelerInstance.current.saveSVG();
        }
    }));

    function getViewPosition(modeler) {
        const canvas = modeler.get('canvas');
        const zoom = canvas.zoom();
        const scroll = canvas.viewbox();

        return {
            zoom,
            scroll
        };
    }

    function setViewPosition(modeler) {
        const canvas = modeler.get('canvas');
        canvas.zoom(viewPosition.zoom);
        canvas.viewbox({
            x: viewPosition.scroll.x,
            y: viewPosition.scroll.y,
            width: viewPosition.scroll.width,
            height: viewPosition.scroll.height
        });
    }

    return <div ref={modelerRef} className="bpmn-modeler" />;
});

export default BPMNModelerComponent;
