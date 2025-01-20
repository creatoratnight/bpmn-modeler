import React from 'react';

const LogoutModal = ({ isOpen, onSaveAndLogout, onLogout, onClose, changes }) => {
    if (!isOpen) return null;

    return (
        <div className="modal modal-modeler">
            <div className="modal-window">
                <div className="modal-title modal-danger">
                    Logout
                </div>
                <div className="modal-content">
                    <p>Are you sure you want to log out?</p>
                    {changes && <p>You have unsaved changes in your BPMN model, do you want to save your model before
                        leaving?</p>}
                    {changes && <button onClick={onSaveAndLogout}>Save changes and logout</button>}
                    {changes && <button className="button-danger" onClick={onLogout}>Discard changes and logout</button>}
                    {!changes && <button className="button-danger" onClick={onLogout}>Yes, logout</button>}
                    <button onClick={onClose}>Don't logout</button>
                </div>
            </div>
        </div>
    );
};

export default LogoutModal;
