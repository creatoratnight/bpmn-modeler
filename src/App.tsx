import './App.css'
import BPMNModelerComponent from "./components/BpmnModeler.tsx";
import {auth} from './config/.firebase.js';
import {saveBPMNModel, saveDMNodel} from './services/models.service.tsx'
import {signInWithGoogle, signInWithMicrosoft, logout} from './services/user.service.tsx';
import { onAuthStateChanged } from 'firebase/auth';
import React, { useEffect, useState, useRef, useCallback } from "react";
import ProjectList from "./components/ProjectList.tsx";
import SaveModal from "./components/SaveModal.tsx";
import LogoutModal from "./components/LogoutModal.tsx";
import DMNModelerComponent from "./components/DmnModeler.tsx";
import toastr from 'toastr';
import {Button, OverflowMenu, OverflowMenuItem, Toggle, Tile} from '@carbon/react';
import {Save, Login, Download, Image as PNG} from '@carbon/react/icons';
import { child, get, getDatabase, ref, set } from 'firebase/database';
import { FaGoogle, FaMicrosoft } from 'react-icons/fa';
import config from './config/config';
import {downloadXmlAsBpmn} from './services/utils.service.tsx';


function App() {
    const [user, setUser] = useState(null);
    const [model, setModel] = useState({});
    const [autoSave, setAutoSave] = useState(() => {
        const saved = localStorage.getItem('autoSave');
        return saved ? JSON.parse(saved) : false;
    });
    const [project, setProject] = useState({});
    const [folder, setfolder] = useState({});
    const [viewMode, setViewMode] = useState('ALL_PROJECTS');
    const [changes, setChanges] = useState(false);
    const [viewPosition, setViewPosition] = useState(null);
    const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
    const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);
    const [userAvatar, setUserAvatar] = useState('user.png');
    const bpmnModelerRef = useRef(null);

    const autoSaveRef = useRef(autoSave);
    const modelRef = useRef(model);

    useEffect(() => {
        autoSaveRef.current = autoSave;
        localStorage.setItem('autoSave', JSON.stringify(autoSave));
    }, [autoSave]);

    useEffect(() => {
        modelRef.current = model;
    }, [model]);

    toastr.options = {
        closeButton: false,
        debug: false,
        newestOnTop: false,
        progressBar: false,
        positionClass: 'toast-bottom-full-width',
        preventDuplicates: false,
        onclick: null,
        showDuration: '200',
        hideDuration: '600',
        timeOut: '2500',
        extendedTimeOut: '1000',
        showEasing: 'swing',
        hideEasing: 'linear',
        showMethod: 'fadeIn',
        hideMethod: 'fadeOut',
    };

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            if (user) {
                // User is signed in, see docs for a list of available properties
                // https://firebase.google.com/docs/reference/js/firebase.User
                setUser(user);
                setViewMode('ALL_PROJECTS');

                // Fetch user avatar from the database
                const db = getDatabase();
                const userRef = ref(db, 'users/' + user.uid);
                const snapshot = await get(child(userRef, '/'));
                if (snapshot.exists()) {
                    const userData = snapshot.val();
                    setUserAvatar(userData.imageUrl || 'user.png');
                }
            } else {
                // User is signed out
                setUser(null);
            }
        });

        // Cleanup subscription on unmount
        return () => unsubscribe();
    }, []);

    const onSaveModelClick = (model) => {
        saveBPMNModel(model);
        setChanges(false);
    };

    const onSaveDMNClick = (model) => {
        saveDMNodel(model);
        setChanges(false);
    };

    const handleOpenProject = (project) => {
        if (project){
            setProject(project);
            // setfolder({});
            setViewMode('PROJECT');
        }
    };

    const handleOpenModel = (project, model) => {
        //TODO: remove if statement if DMN is supported
        if (model?.type === 'bpmn') {
            setProject(project);
            setModel(model);
            setViewMode(model.type === 'bpmn' ? 'BPMN' : 'DMN');
        }

        if (model?.type === 'folder') {
            setfolder(model);
        }

        if (model?.type === 'folderUp') {
            setfolder({});
        }
    };

    const handleModelChange = useCallback((newXml) => {
        setChanges(true);
        const updatedModel = {
            ...modelRef.current,
            xmlData: newXml
        };
        setModel(updatedModel);
        if (autoSaveRef.current) {
            saveBPMNModel(updatedModel);
            setChanges(false);
        }
    }, []);

    const handleViewPositionChange = (viewbox) => {
        setViewPosition(viewbox);
    }

    const onMyProjectsNavClick = () => {
        if (!changes) {
            setProject({});
            setfolder({});
            setModel({});
            setViewMode('ALL_PROJECTS');
            setViewPosition(null);
            setChanges(false);
        } else {
         setIsSaveModalOpen(true);
        }
    }

    const onCurrentProjectNavClick = () => {
        if (!changes) {
            setModel({});
            setfolder({});
            setViewMode('PROJECT');
            setViewPosition(null);
            setChanges(false);
        } else {
         setIsSaveModalOpen(true);
         setfolder({});
        }
    }

    const onCurrentFolderNavClick = () => {
        if (!changes) {
            setModel({});
            setViewMode('PROJECT');
            setViewPosition(null);
            setChanges(false);
        } else {
         setIsSaveModalOpen(true);
        }
    }

    const handleOnSave = (model) => {
        saveBPMNModel(model);
        setModel({});
        setViewMode('PROJECT');
        setViewPosition(null);
        setChanges(false);
        setIsSaveModalOpen(false);
    }

    const handleOnDiscard = () => {
        setModel({});
        setViewMode('PROJECT');
        setViewPosition(null);
        setChanges(false);
        setIsSaveModalOpen(false);
    }

    const onLogoutClick = () => {
        setIsLogoutModalOpen(true);
    }

    const handleOnSaveLogout = (model) => {
        if (model.type === 'bpmn') {
            saveBPMNModel(model);
        } else if (model.type === 'dmn') {
            saveDMNodel(model);
        }
        setModel({});
        setProject({});
        setViewMode('ALL_PROJECTS');
        logout();
        setIsLogoutModalOpen(false);
    }

    const handleOnDiscardLogout = () => {
        setModel({});
        setProject({});
        setViewMode('ALL_PROJECTS');
        logout();
        setIsLogoutModalOpen(false);
    }

    const handleCloseLogout = () => {
        setIsLogoutModalOpen(false);
    }

    const handleNavigateHome = () => {
        setProject({});
        setViewMode('ALL_PROJECTS');
    }

    const onDownloadAsPng = async () => {
        if (bpmnModelerRef.current) {
            try {
                const { svg } = await bpmnModelerRef.current.saveSVG();
                const canvas = document.createElement('canvas');
                const context = canvas.getContext('2d');
                const image = new Image();

                image.onload = () => {
                    canvas.width = image.width * 1.5;
                    canvas.height = image.height * 1.5;
                    context.drawImage(image, 0, 0, image.width * 1.5, image.height * 1.5);

                    const pngUrl = canvas.toDataURL('image/png');
                    const link = document.createElement('a');
                    link.download = `${model.name || 'diagram'}.png`; // TODO: Implement versioning in file name
                    link.href = pngUrl;
                    link.click();
                };
                image.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
            } catch (err) {
                toastr.error('Could not save BPMN diagram as PNG.', err);
            }
        }
    };

    return (
      <div className="App">
          {model && <SaveModal
              isOpen={isSaveModalOpen}
              onSave={() => handleOnSave(model)}
              onDiscard={handleOnDiscard}
          />}
          {model && <LogoutModal
              isOpen={isLogoutModalOpen}
              onSaveAndLogout={() => handleOnSaveLogout(model)}
              onLogout={handleOnDiscardLogout}
              onClose={handleCloseLogout}
              changes={changes}
          />}
          <Tile className="header">
              <div className="header-logo">
                  <img src="/bpmn_modeler_logo.png" alt="valtimo academy logo"/>
              </div>
              <div className="header-nav">
                  {user && <div className="nav-projects-folder" onClick={onMyProjectsNavClick}>
                      Projects
                  </div>}
                  {project.name && <div>
                      &#8594;
                  </div>}
                  {project.name && <div className="nav-project" onClick={onCurrentProjectNavClick}>
                      {project.name}
                  </div>}
                  {folder.name && <div>
                      &#8594;
                  </div>}
                  {folder.name && <div className="nav-project" onClick={onCurrentFolderNavClick}>
                      {folder.name}
                  </div>}
                  {model.name && <div>
                      &#8594;
                  </div>}
                  {model.name && <div className="nav-model">
                      {model.name}
                  </div>}
              </div>
              <div className="header-user">
                  {!user &&
                    <div className="header-user-sign-in">
                      {config.enableGoogleSignIn && (
                        <Button size="sm" onClick={signInWithGoogle}><FaGoogle className="project-name-icon"/>Sign in with Google</Button>
                      )}
                      {config.enableMicrosoftSignIn && (
                        <Button size="sm" onClick={signInWithMicrosoft}><FaMicrosoft className="project-name-icon"/>Sign in with Microsoft</Button>
                      )}
                    </div>
                  }
                  {user &&
                      <div className="header-user-signed-in">
                          <img src={userAvatar} alt="user-avatar" style={{
                              width: '32px',
                              height: '32px',
                              borderRadius: '16px'
                          }}/>
                          Welcome, {user.displayName}
                          <OverflowMenu flipped>
                              <OverflowMenuItem
                                  itemText="Logout"
                                  isDelete
                                  onClick={(e) => {
                                      e.stopPropagation();
                                      onLogoutClick();
                                  }}
                              />
                          </OverflowMenu>
                      </div>
                  }
              </div>
          </Tile>
          {viewMode === ('BPMN' || 'DMN') &&
          <div className="modeler-toolbar-background"></div>}
            <div className="modeler-toolbar">
                <div className="modeler-toolbar-left">
                    {viewMode === 'BPMN' &&
                        <Button
                            onClick={() => downloadXmlAsBpmn(model)}
                            className="download-bpmn-button"
                            hasIconOnly
                            renderIcon={Download}
                            iconDescription="Download BPMN"
                            tooltipPosition="right"
                        />}
                    {viewMode === 'BPMN' &&
                        <Button
                            onClick={onDownloadAsPng}
                            className="download-png-button"
                            hasIconOnly
                            renderIcon={PNG}
                            iconDescription="Download as image"
                            tooltipPosition="right"
                        />}
                </div>
                <div className="modeler-toolbar-right">
                    {viewMode === 'BPMN' &&
                        <Toggle
                            className="auto-save-toggle"
                            id="auto-save"
                            labelText="Auto save"
                            hideLabel={true}
                            size="sm"
                            toggled={autoSave}
                            onToggle={(checked) => {
                                if (checked) {
                                    saveBPMNModel(model);
                                    setChanges(false);
                                }
                                setAutoSave(checked)
                            }}
                        />}
                    {viewMode === 'BPMN' && changes &&
                        <Button onClick={() => onSaveModelClick(model)}>
                            <Save className="project-name-icon"/> Save
                        </Button>}
                    {viewMode === 'BPMN' && !changes &&
                        <Button onClick={() => onSaveModelClick(model)} disabled>
                            <Save className="project-name-icon"/> Save
                        </Button>}
                    {viewMode === 'DMN' &&
                        <Button onClick={() => onSaveDMNClick(model)}>
                            Save
                        </Button>}
                </div>
            </div>
          {viewMode === 'BPMN' && user && <BPMNModelerComponent ref={bpmnModelerRef} xml={model.xmlData} viewPosition={viewPosition} onModelChange={handleModelChange} onViewPositionChange={handleViewPositionChange}/>}
          {viewMode === 'DMN' && user && <DMNModelerComponent xml={model.xmlData} viewPosition={viewPosition} onDMNChange={handleModelChange} onViewPositionChange={handleViewPositionChange}/>}
          {(viewMode !== 'BPMN' && viewMode !== 'DMN') && user && <ProjectList user={user} viewMode={viewMode} currentProject={project} selectedFolder={folder} onOpenProject={handleOpenProject} onNavigateHome={handleNavigateHome} onOpenModel={handleOpenModel}/>}
          {!user && <div className="welcome-wrapper">
                <img src="/bpmn_modeler_logo.png" alt="BPMN Modeler logo" className='welcome-logo'/>
              <div className="welcome-title">
                  Welcome to BPMN Modeler!
              </div>
              <div className="welcome-subtitle">
                  the open-source BPMN & DMN modeling collaboration tool
              </div>
          </div>}
          {(viewMode !== 'BPMN' && viewMode !== 'DMN') && <Tile className="footer">
              Version: {config.bpmnModelerVersion} - powered by <a href="https://www.valtimo.nl" target="valtimo">Valtimo</a>
          </Tile>}
      </div>
    )
}

export default App
