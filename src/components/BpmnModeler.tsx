import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import BpmnModeler from 'bpmn-js/lib/Modeler';
import BpmnColorPickerModule from 'bpmn-js-color-picker';
import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css';
import minimapModule from 'diagram-js-minimap';
import { CollabBinding } from '../collaboration/CollabBinding';
import { CollabDoc } from '../collaboration/CollabDoc';


const BPMNModelerComponent = forwardRef(({ xml, viewPosition, onModelChange, onViewPositionChange, collabSession }, ref) => {
    const modelerRef = useRef(null);
    const modelerInstance = useRef(null);
    const [isReady, setIsReady] = useState(false);

    useEffect(() => {
        modelerInstance.current = new BpmnModeler({
            container: modelerRef.current,
            keyboard: {
                bindTo: window,
            },
            additionalModules: [
                BpmnColorPickerModule,
                minimapModule
            ]
        });

        modelerInstance.current.importXML(xml).then(() => {
            if (viewPosition) {
                setViewPosition(modelerInstance.current);
            }
            // E2E test hook: expose the ready modeler so Playwright can drive it
            // (e2e mode only — guarded so it never ships in production builds).
            if (import.meta.env.VITE_FIREBASE_EMULATOR === 'true') {
                (window as any).__E2E_BPMN__ = modelerInstance.current;
            }
            // Signals the collaboration binding effect that the modeler is ready.
            setIsReady(true);
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
            if (import.meta.env.VITE_FIREBASE_EMULATOR === 'true') {
                delete (window as any).__E2E_BPMN__;
            }
            modelerInstance.current.destroy();
        };
    }, []);

    // Attach the real-time collaboration binding (peer cursors + selection
    // overlay) once the modeler is ready and a session is available. Kept in its
    // own effect because `collabSession` arrives on the render *after* mount.
    useEffect(() => {
        if (!isReady || !collabSession || !modelerInstance.current) return;
        const binding = new CollabBinding(modelerInstance.current, collabSession);
        binding.start();
        const collabDoc = new CollabDoc(modelerInstance.current, collabSession);
        collabDoc.start();
        return () => { binding.stop(); collabDoc.stop(); };
    }, [isReady, collabSession]);

    useImperativeHandle(ref, () => ({
        saveSVG: () => {
            return modelerInstance.current.saveSVG();
        },
        handleResize: () => {
            if (modelerInstance.current) {
                const canvas = modelerInstance.current.get('canvas');
                canvas.resized();
            }
        },
        importXML: (newXml) => {
            if (modelerInstance.current) {
                return modelerInstance.current.importXML(newXml);
            }
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
