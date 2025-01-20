import React, { useEffect, useRef } from 'react';
import BpmnModeler from 'bpmn-js/lib/Modeler';
import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css';


const BPMNModelerComponent = ({ xml, viewPosition, onModelChange, onViewPositionChange }) => {
    const modelerRef = useRef(null);

    useEffect(() => {
        const modeler = new BpmnModeler({
            container: modelerRef.current,
            keyboard: {
                bindTo: window,
            },
        });

        modeler.importXML(xml).then(() => {
            if (viewPosition) {
                setViewPosition(modeler);
            }
        });

        modeler.on('canvas.viewbox.changed', () => {
            const viewbox = getViewPosition(modeler);
            if (viewPosition !== viewbox) {
                onViewPositionChange(viewbox);
            }
        });

        modeler.on(['commandStack.changed'], async () => {
            try {
                const { xml } = await modeler.saveXML({ format: true });
                onModelChange(xml);
            } catch (err) {
                console.error('Error saving XML', err);
            }
        });

        return () => {
            modeler.destroy();
        };
    }, []);

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
};

export default BPMNModelerComponent;
