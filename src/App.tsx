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
import {Save, Login, Download, Image as PNG, OpenPanelLeft, Folder, DecisionTree, TableSplit, FolderParent, RightPanelOpen, SidePanelOpen, SidePanelClose} from '@carbon/react/icons';
import { child, get, getDatabase, ref, set, query, orderByChild, equalTo } from 'firebase/database';
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
    const [isProjectViewerOpen, setIsProjectViewerOpen] = useState(() => {
        const saved = localStorage.getItem('isProjectViewerOpen');
        return saved ? JSON.parse(saved) : false;
    });
    const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
    const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);
    const [userAvatar, setUserAvatar] = useState('user.png');
    const bpmnModelerRef = useRef(null);
    const dmnModelerRef = useRef(null);

    const autoSaveRef = useRef(autoSave);
    const modelRef = useRef(model);
    const projectRef = useRef(project);

    useEffect(() => {
        autoSaveRef.current = autoSave;
        localStorage.setItem('autoSave', JSON.stringify(autoSave));
    }, [autoSave]);

    useEffect(() => {
        modelRef.current = model;
    }, [model]);

    useEffect(() => {
        projectRef.current = project;
    }, [project]);

    useEffect(() => {
        localStorage.setItem('isProjectViewerOpen', JSON.stringify(isProjectViewerOpen));
    }, [isProjectViewerOpen]);

    useEffect(() => {
        setTimeout(() => {
            if (viewMode === 'BPMN' && bpmnModelerRef.current) {
                bpmnModelerRef.current.handleResize();
            }
            if (viewMode === 'DMN' && dmnModelerRef.current) {
                dmnModelerRef.current.handleResize();
            }
        }, 100);
    }, [isProjectViewerOpen, viewMode]);

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

    const fetchProjectData = useCallback(async (projectId) => {
        if (!projectId) return;
        const db = getDatabase();

        try {
            const projectRef = ref(db, `projects/${projectId}`);
            const projectSnapshot = await get(projectRef);

            if (projectSnapshot.exists()) {
                const projectData = projectSnapshot.val();

                const modelsRef = ref(db, 'bpmnModels');
                const modelsQuery = query(modelsRef, orderByChild('projectId'), equalTo(projectId));
                const modelsSnapshot = await get(modelsQuery);

                const models = [];
                if (modelsSnapshot.exists()) {
                    modelsSnapshot.forEach((childSnapshot) => {
                        models.push({
                            id: childSnapshot.key,
                            ...childSnapshot.val()
                        });
                    });
                }

                const folders = Object.keys(projectData.folders || {}).map(key => ({
                    id: key,
                    ...projectData.folders[key],
                    type: 'folder'
                }));

                const { members, ...restProjectData } = projectData;

                setProject(prev => ({
                    ...prev,
                    ...restProjectData,
                    models: models,
                    folders: folders
                }));
            }
        } catch (error) {
            console.error("Error refreshing project data:", error);
        }
    }, []);

    const onSaveModelClick = (model) => {
        saveBPMNModel(model).then(() => fetchProjectData(project.id));
        setChanges(false);
    };

    const onSaveDMNClick = (model) => {
        saveDMNodel(model).then(() => fetchProjectData(project.id));
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
            saveBPMNModel(updatedModel).then(() => {
                if (projectRef.current?.id) {
                    fetchProjectData(projectRef.current.id);
                }
            });
            setChanges(false);
        }
    }, [fetchProjectData]);

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

    const getSidePanelItems = () => {
        if (!project || !project.models) return [];

        const currentFolderId = folder.id || null;
        let items = [];

        if (currentFolderId) {
            items.push({ type: 'folderUp', name: '.. / ' + folder.name || '', id: 'up' });
        } else {
            const folders = (project.folders || []).map(f => ({ ...f, type: 'folder' }));
            items = [...items, ...folders];
        }

        const models = (project.models || [])
            .filter(m => m.folder === currentFolderId || (!m.folder && !currentFolderId));

        items = [...items, ...models];

        return items.sort((a, b) => {
            if (a.type === 'folderUp') return -1;
            if (b.type === 'folderUp') return 1;
            if (a.type === 'folder' && b.type !== 'folder') return -1;
            if (a.type !== 'folder' && b.type === 'folder') return 1;
            return (a.name || '').localeCompare(b.name || '');
        });
    };

    const handleSidePanelItemClick = (item) => {
        if (item.id === model.id) return;

        if (item.type === 'dmn') return;

        if (changes) {
            toastr.warning("You have unsaved changes. Please save them before switching models.");
            return;
        }

        if (item.type === 'folder' || item.type === 'folderUp') {
            setfolder(item.type === 'folderUp' ? {} : item);
        } else {
            setModel(item);
            setViewPosition(null);
            setViewMode(item.type === 'bpmn' ? 'BPMN' : 'DMN');
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
          {(viewMode === 'BPMN' || viewMode === 'DMN') && user ? (
              <div style={{ display: 'flex', width: '100%', overflow: 'hidden' }}>
                  {isProjectViewerOpen && (
                      <div style={{ width: '250px', minWidth: '250px', maxHeight: 'calc(100vh - 64px)', borderRight: '2px solid #e0e0e0', backgroundColor: '#efefef', overflowY: 'auto', zIndex: 900 }}>
                        <div style={{ height: '2px', width: '250px', backgroundColor: '#e0e0e0', position: 'absolute'}}></div>
                          {getSidePanelItems().map(item => (
                              <div
                                  key={item.id}
                                  onClick={() => handleSidePanelItemClick(item)}
                                  style={{
                                      cursor: item.type === 'dmn' ? 'not-allowed' : 'pointer',
                                      padding: '0.5rem 1rem',
                                      display: 'flex',
                                      alignItems: 'center',
                                      backgroundColor: (model.id === item.id || folder.id === item.id) ? '#e0e0e0' : 'transparent',
                                      borderBottom: '2px solid #e0e0e0',
                                      color: '#161616'
                                  }}
                                  title={item.name}
                              >
                                  {item.type === 'folder' && <Folder />}
                                  {item.type === 'folderUp' && <FolderParent />}
                                  {item.type === 'bpmn' && <DecisionTree />}
                                  {item.type === 'dmn' && <TableSplit />}
                                  <span style={{ marginLeft: '0.5rem', fontSize: '0.875rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                      {item.type === 'folder' || item.type === 'folderUp' ? <strong>{item.name}</strong> : item.name}
                                  </span>
                              </div>
                          ))}
                      </div>
                  )}
                  <div style={{ flex: 1, position: 'relative', height: '100%', overflow: 'hidden' }}>
                      <div className="modeler-toolbar-background"></div>
                      <div className="modeler-toolbar">
                          <div className="modeler-toolbar-left">
                                <Button
                                    onClick={() => setIsProjectViewerOpen(!isProjectViewerOpen)}
                                    className={isProjectViewerOpen ? "selected" : ""}
                                    hasIconOnly
                                    renderIcon={isProjectViewerOpen ? SidePanelClose : SidePanelOpen}
                                    iconDescription={isProjectViewerOpen ? "Close project panel" : "Open project panel"}
                                    tooltipPosition="right"
                                />
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
                      {viewMode === 'BPMN' && <BPMNModelerComponent key={model.id} ref={bpmnModelerRef} xml={model.xmlData} viewPosition={viewPosition} onModelChange={handleModelChange} onViewPositionChange={handleViewPositionChange}/>}
                      {viewMode === 'DMN' && <DMNModelerComponent key={model.id} ref={dmnModelerRef} xml={model.xmlData} viewPosition={viewPosition} onDMNChange={handleModelChange} onViewPositionChange={handleViewPositionChange}/>}
                  </div>
              </div>
          ) : (
              <>
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
              </>
          )}
          {(viewMode !== 'BPMN' && viewMode !== 'DMN') && <Tile className="footer">
              Version: {config.bpmnModelerVersion} - powered by <a href="https://www.valtimo.nl" target="valtimo">Valtimo</a>
          </Tile>}
      </div>
    )
}

export default App
