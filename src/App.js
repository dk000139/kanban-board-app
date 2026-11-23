import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

const STORAGE_KEY = "kanban-board-app:v2";
const STORAGE_BACKUP_KEY = `${STORAGE_KEY}:backup`;

const DEFAULT_PRIORITY_COLUMNS = [
  {
    id: "today",
    label: "今日やる",
    description: "今日中に片付けたいタスク",
    accent: "#f97316"
  },
  {
    id: "medium",
    label: "中",
    description: "今週のうちに進めるもの",
    accent: "#38bdf8"
  },
  {
    id: "low",
    label: "低",
    description: "優先度低め・空いた時間で",
    accent: "#a78bfa"
  },
  {
    id: "pending",
    label: "Pending",
    description: "他の人待ち・保留中",
    accent: "#94a3b8"
  }
];

const DEFAULT_PROJECT_OPTIONS = [];
const DURATION_OPTIONS = [3, 5, 10, 20, 30, 60, 120, 180];
const URL_SPLIT_REGEX = /(https?:\/\/[^\s]+)/gi;
const URL_TEST_REGEX = /^https?:\/\/[^\s]+$/i;
const isComposingEvent = event => Boolean(event?.isComposing || event?.nativeEvent?.isComposing);
const CSV_HEADERS = ["案件タグ", "チケットタイトル", "優先度", "想定所要時間", "メモ", "作成したタイムスタンプ"];
const UNDO_STACK_LIMIT = 50;
const cloneBoardState = boardState => JSON.parse(JSON.stringify(boardState));

const DEFAULT_BOARD = DEFAULT_PRIORITY_COLUMNS.reduce((acc, column) => {
  acc[column.id] = [];
  return acc;
}, {});

const COMPLETED_WINDOW_MS = 1000 * 60 * 60 * 24;
const COMPLETED_HISTORY_LIMIT = 50;

const normalizePriorityColumns = columns => {
  const savedById = new Map(
    (Array.isArray(columns) ? columns : []).map(column => [column?.id, column])
  );
  return DEFAULT_PRIORITY_COLUMNS.map(defaultColumn => {
    const saved = savedById.get(defaultColumn.id) ?? {};
    return {
      ...defaultColumn,
      label: typeof saved.label === "string" && saved.label.trim() ? saved.label.trim() : defaultColumn.label,
      description:
        typeof saved.description === "string" ? saved.description.trim() : defaultColumn.description
    };
  });
};

const normalizeProjects = projects => {
  if (!Array.isArray(projects)) {
    return [];
  }

  const cleaned = projects
    .map(item => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
  const unique = [...new Set(cleaned)];
  return unique;
};

const normalizeBoard = board => {
  const normalized = { ...DEFAULT_BOARD };
  DEFAULT_PRIORITY_COLUMNS.forEach(column => {
    const tasks = Array.isArray(board[column.id]) ? board[column.id] : [];
    normalized[column.id] = tasks.map(task => ({
      id: String(task.id ?? crypto.randomUUID?.() ?? Math.random()),
      title: task.title ?? "Untitled task",
      detail: task.detail ?? "",
      project: task.project ?? "",
      duration: Number(task.duration) || DURATION_OPTIONS[0],
      createdAt: task.createdAt ?? Date.now(),
      isActive: Boolean(task.isActive),
      isPaused: Boolean(task.isPaused),
      timerRemainingSeconds:
        typeof task.timerRemainingSeconds === "number" ? task.timerRemainingSeconds : null,
      timerLastStartedAt: typeof task.timerLastStartedAt === "number" ? task.timerLastStartedAt : null
    }));
  });
  return normalized;
};

const normalizeCompletedTasks = entries => {
  if (!Array.isArray(entries)) {
    return [];
  }
  const now = Date.now();
  return entries
    .map(entry => ({
      id: entry.id ?? `completed-${Math.random().toString(16).slice(2)}` ,
      title: entry.title ?? "",
      project: entry.project ?? "",
      completedAt: typeof entry.completedAt === "number" ? entry.completedAt : now
    }))
    .filter(entry => now - entry.completedAt <= COMPLETED_WINDOW_MS);
};

const pruneCompletedEntries = list =>
  list
    .filter(entry => Date.now() - entry.completedAt <= COMPLETED_WINDOW_MS)
    .slice(-COMPLETED_HISTORY_LIMIT);

const readStoragePayload = key => {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const normalizePersistedPayload = payload => {
  if (!payload) {
    return null;
  }

  return {
    board: normalizeBoard(payload.board ?? payload),
    projects: payload.projects ? normalizeProjects(payload.projects) : [...DEFAULT_PROJECT_OPTIONS],
    completedTasks: normalizeCompletedTasks(payload.completedTasks ?? []),
    priorityColumns: normalizePriorityColumns(payload.priorityColumns)
  };
};

const persistBoardState = (boardState, projects, completedTasks = [], priorityColumns = DEFAULT_PRIORITY_COLUMNS) => {
  if (typeof window === "undefined") {
    return;
  }

  const payload = {
    board: boardState,
    projects,
    completedTasks,
    priorityColumns,
    savedAt: Date.now()
  };

  const serialized = JSON.stringify(payload);
  const write = key => {
    try {
      window.localStorage.setItem(key, serialized);
    } catch {
      // localStorage might be unavailable (private mode / quota). Ignore but keep UI usable.
    }
  };

  write(STORAGE_KEY);
  write(STORAGE_BACKUP_KEY);
};

const loadPersistedState = () => {
  const current = normalizePersistedPayload(readStoragePayload(STORAGE_KEY));
  if (current) {
    persistBoardState(current.board, current.projects, current.completedTasks ?? [], current.priorityColumns);
    return current;
  }

  const backup = normalizePersistedPayload(readStoragePayload(STORAGE_BACKUP_KEY));
  if (backup) {
    persistBoardState(backup.board, backup.projects, backup.completedTasks ?? [], backup.priorityColumns);
    return backup;
  }

  return null;
};

const getInitialData = () => {
  const fallback = {
    board: { ...DEFAULT_BOARD },
    projects: [],
    completedTasks: [],
    priorityColumns: normalizePriorityColumns()
  };

  if (typeof window === "undefined") {
    return fallback;
  }

  const persisted = loadPersistedState();
  if (persisted) {
    return persisted;
  }

  return fallback;
};

const createTaskId = () => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `task-${Math.random().toString(16).slice(2)}`;
};

function App() {
  const [initialData] = useState(() => getInitialData());
  const [board, setBoard] = useState(initialData.board);
  const [projectOptions, setProjectOptions] = useState(initialData.projects);
  const [priorityColumns, setPriorityColumns] = useState(initialData.priorityColumns);
  const [projectDraft, setProjectDraft] = useState("");
  const [editingProject, setEditingProject] = useState(null);
  const [draggedProject, setDraggedProject] = useState(null);
  const [editingColumn, setEditingColumn] = useState(null);
  const [activeColumnId, setActiveColumnId] = useState(null);
  const [dragState, setDragState] = useState(null);
  const [dropIndicator, setDropIndicator] = useState(null);
  const [editingField, setEditingField] = useState(null);
  const [newTask, setNewTask] = useState(() => ({
    title: "",
    detail: "",
    priority: DEFAULT_PRIORITY_COLUMNS[0].id,
    project: initialData.projects[0] ?? "",
    duration: DURATION_OPTIONS[0]
  }));
  const [completedTasks, setCompletedTasks] = useState(initialData.completedTasks ?? []);
  const undoStackRef = useRef([]);
  const isUndoingRef = useRef(false);
  const importInputRef = useRef(null);
  const copyToastTimerRef = useRef(null);
  const activeTimerTaskIdRef = useRef(null);
  const [copyToast, setCopyToast] = useState("");
  const [timerNow, setTimerNow] = useState(() => Date.now());

  const applyBoardChange = useCallback(
    updater => {
      setBoard(prev => {
        const next = updater(prev);
        if (next === prev) {
          if (isUndoingRef.current) {
            isUndoingRef.current = false;
          }
          return prev;
        }

        if (!isUndoingRef.current) {
          const snapshot = cloneBoardState(prev);
          const nextHistory = [...undoStackRef.current, snapshot];
          if (nextHistory.length > UNDO_STACK_LIMIT) {
            nextHistory.shift();
          }
          undoStackRef.current = nextHistory;
        } else {
          isUndoingRef.current = false;
        }

        return next;
      });
    },
    [setBoard]
  );

  const handleUndo = useCallback(() => {
    const history = undoStackRef.current;
    if (!history.length) {
      return;
    }
    const previous = history.pop();
    isUndoingRef.current = true;
    setBoard(previous);
  }, [setBoard]);

  useEffect(() => {
    persistBoardState(board, projectOptions, completedTasks, priorityColumns);
  }, [board, projectOptions, completedTasks, priorityColumns]);

  useEffect(() => {
    setCompletedTasks(prev => {
      const pruned = pruneCompletedEntries(prev);
      return pruned.length === prev.length ? prev : pruned;
    });
  }, []);

  useEffect(() => {
    const intervalId = setInterval(() => {
      setCompletedTasks(prev => {
        const pruned = pruneCompletedEntries(prev);
        return pruned.length === prev.length ? prev : pruned;
      });
    }, 60000);
    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (projectOptions.length === 0) {
      setNewTask(prev => ({ ...prev, project: "" }));
      return;
    }

    if (!projectOptions.includes(newTask.project)) {
      setNewTask(prev => ({ ...prev, project: projectOptions[0] }));
    }
  }, [projectOptions, newTask.project]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const handleKeyDown = event => {
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "z") {
        event.preventDefault();
        handleUndo();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleUndo]);

  const totalTasks = useMemo(
    () => priorityColumns.reduce((count, column) => count + board[column.id].length, 0),
    [board, priorityColumns]
  );

  const recentCompleted = useMemo(() => pruneCompletedEntries(completedTasks), [completedTasks]);

  const activeTask = useMemo(() => {
    for (const column of priorityColumns) {
      const tasks = board[column.id] ?? [];
      const found = tasks.find(task => task.isActive);
      if (found) {
        return { columnId: column.id, task: found };
      }
    }
    return null;
  }, [board, priorityColumns]);

  useEffect(() => {
    const nextActiveTaskId = activeTask?.task?.id ?? null;
    const prevActiveTaskId = activeTimerTaskIdRef.current;
    if (prevActiveTaskId === nextActiveTaskId) {
      return;
    }

    activeTimerTaskIdRef.current = nextActiveTaskId;
    const now = Date.now();

    applyBoardChange(prev => {
      let changed = false;
      const next = { ...prev };

      const pauseTaskId = prevActiveTaskId;
      if (pauseTaskId) {
        Object.keys(next).forEach(columnId => {
          next[columnId] = next[columnId].map(task => {
            if (task.id !== pauseTaskId) {
              return task;
            }
            const lastStartedAt =
              typeof task.timerLastStartedAt === "number" ? task.timerLastStartedAt : null;
            if (!lastStartedAt) {
              return task;
            }
            const baseRemaining =
              typeof task.timerRemainingSeconds === "number"
                ? task.timerRemainingSeconds
                : (Number(task.duration) || DURATION_OPTIONS[0]) * 60;
            const elapsedSeconds = Math.floor((now - lastStartedAt) / 1000);
            const nextRemaining = baseRemaining - Math.max(0, elapsedSeconds);
            changed = true;
            return { ...task, timerRemainingSeconds: nextRemaining, timerLastStartedAt: null };
          });
        });
      }

      if (nextActiveTaskId) {
        Object.keys(next).forEach(columnId => {
          next[columnId] = next[columnId].map(task => {
            if (task.id !== nextActiveTaskId) {
              return task;
            }
            const alreadyRunning = typeof task.timerLastStartedAt === "number";
            if (alreadyRunning) {
              return task;
            }
            const baseRemaining =
              typeof task.timerRemainingSeconds === "number"
                ? task.timerRemainingSeconds
                : (Number(task.duration) || DURATION_OPTIONS[0]) * 60;
            changed = true;
            return { ...task, timerRemainingSeconds: baseRemaining, timerLastStartedAt: now };
          });
        });
      }

      return changed ? next : prev;
    });
  }, [activeTask?.task?.id, applyBoardChange]);

  useEffect(() => {
    if (!activeTask) {
      return;
    }
    const intervalId = setInterval(() => setTimerNow(Date.now()), 250);
    return () => clearInterval(intervalId);
  }, [activeTask]);

  const activeTimerSignedSeconds = useMemo(() => {
    if (!activeTask) {
      return null;
    }
    const { task } = activeTask;
    const baseRemaining =
      typeof task.timerRemainingSeconds === "number"
        ? task.timerRemainingSeconds
        : (Number(task.duration) || DURATION_OPTIONS[0]) * 60;
    const lastStartedAt = typeof task.timerLastStartedAt === "number" ? task.timerLastStartedAt : null;
    if (!lastStartedAt) {
      return baseRemaining;
    }
    const elapsedSeconds = Math.floor((timerNow - lastStartedAt) / 1000);
    return baseRemaining - Math.max(0, elapsedSeconds);
  }, [activeTask, timerNow]);

  const formattedWorkTimer = useMemo(() => {
    if (activeTimerSignedSeconds === null) {
      return null;
    }
    const sign = activeTimerSignedSeconds < 0 ? "-" : "";
    const totalSeconds = Math.abs(activeTimerSignedSeconds);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const pad = value => String(value).padStart(2, "0");
    if (hours > 0) {
      return `${sign}${hours}:${pad(minutes)}:${pad(seconds)}`;
    }
    return `${sign}${pad(minutes)}:${pad(seconds)}`;
  }, [activeTimerSignedSeconds]);

  const handleAddTask = event => {
    event.preventDefault();
    if (!newTask.title.trim()) {
      return;
    }

    const task = {
      id: createTaskId(),
      title: newTask.title.trim(),
      detail: newTask.detail.trim(),
      project: newTask.project,
      duration: newTask.duration,
      createdAt: Date.now(),
      isActive: false,
      isPaused: false,
      timerRemainingSeconds: null,
      timerLastStartedAt: null
    };

    applyBoardChange(prev => ({
      ...prev,
      [newTask.priority]: [task, ...prev[newTask.priority]]
    }));

    setNewTask(current => ({
      ...current,
      title: "",
      detail: ""
    }));
  };

  const handleAddProjectOption = () => {
    const value = projectDraft.trim();
    if (!value) {
      return;
    }

    setProjectOptions(prev => {
      if (prev.includes(value)) {
        return prev;
      }
      return [...prev, value];
    });
    setNewTask(prev => ({ ...prev, project: value }));
    setProjectDraft("");
  };

  const handleRemoveProjectOption = option => {
    setProjectOptions(prev => prev.filter(item => item !== option));
  };

  const handleProjectDragStart = option => event => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", option);
    setDraggedProject(option);
  };

  const handleProjectDragOver = event => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  };

  const handleProjectDrop = targetOption => event => {
    event.preventDefault();
    const sourceOption = draggedProject || event.dataTransfer.getData("text/plain");
    if (!sourceOption || sourceOption === targetOption) {
      setDraggedProject(null);
      return;
    }
    setProjectOptions(prev => {
      const sourceIndex = prev.indexOf(sourceOption);
      const targetIndex = prev.indexOf(targetOption);
      if (sourceIndex < 0 || targetIndex < 0) {
        return prev;
      }
      const next = [...prev];
      const [moved] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
    setDraggedProject(null);
  };

  const startEditingProject = option => {
    setEditingProject({ original: option, value: option });
  };

  const commitEditingProject = () => {
    if (!editingProject) {
      return;
    }
    const { original } = editingProject;
    const value = editingProject.value.trim();
    if (!value || (value !== original && projectOptions.includes(value))) {
      setEditingProject(null);
      return;
    }
    setProjectOptions(prev => prev.map(option => (option === original ? value : option)));
    setNewTask(prev => ({ ...prev, project: prev.project === original ? value : prev.project }));
    applyBoardChange(prev => {
      let changed = false;
      const next = { ...prev };
      Object.keys(next).forEach(columnId => {
        next[columnId] = next[columnId].map(task => {
          if (task.project !== original) {
            return task;
          }
          changed = true;
          return { ...task, project: value };
        });
      });
      return changed ? next : prev;
    });
    setCompletedTasks(prev =>
      prev.map(task => (task.project === original ? { ...task, project: value } : task))
    );
    setEditingProject(null);
  };

  const startEditingColumn = (column, field, source = "board") => {
    setEditingColumn({ columnId: column.id, field, source, value: column[field] });
  };

  const commitEditingColumn = () => {
    if (!editingColumn) {
      return;
    }
    const value = editingColumn.value.trim();
    if (editingColumn.field === "label" && !value) {
      setEditingColumn(null);
      return;
    }
    setPriorityColumns(prev =>
      prev.map(column =>
        column.id === editingColumn.columnId
          ? { ...column, [editingColumn.field]: value }
          : column
      )
    );
    setEditingColumn(null);
  };

  const handleInlineEditKeyDown = commit => event => {
    if (isComposingEvent(event)) {
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    } else if (event.key === "Escape") {
      setEditingProject(null);
      setEditingColumn(null);
    }
  };

  const handleDragStart = (columnId, taskId) => event => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", taskId);
    setDragState({ fromColumn: columnId, taskId });
  };

  const handleDragEnd = () => {
    setDragState(null);
    setActiveColumnId(null);
    setDropIndicator(null);
  };

  const moveTask = (targetColumn, targetIndex = null) => {
    if (!dragState) {
      return;
    }

    applyBoardChange(prev => {
      const next = { ...prev };
      const sourceTasks = [...next[dragState.fromColumn]];
      const taskIndex = sourceTasks.findIndex(task => task.id === dragState.taskId);

      if (taskIndex === -1) {
        return prev;
      }

      const [task] = sourceTasks.splice(taskIndex, 1);
      next[dragState.fromColumn] = sourceTasks;

      const destinationTasks = [...next[targetColumn]];
      let normalizedIndex =
        targetIndex === null || targetIndex > destinationTasks.length
          ? destinationTasks.length
          : Math.max(0, targetIndex);

      if (dragState.fromColumn === targetColumn && targetIndex !== null && taskIndex < targetIndex) {
        normalizedIndex = Math.max(0, normalizedIndex - 1);
      }

      destinationTasks.splice(normalizedIndex, 0, { ...task });
      next[targetColumn] = destinationTasks;
      return next;
    });

    setDragState(null);
    setActiveColumnId(null);
    setDropIndicator(null);
  };

  const handleColumnDrop = columnId => event => {
    event.preventDefault();
    moveTask(columnId, null);
  };

  const handleCardDrop = (columnId, index) => event => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect?.();
    const isAfter = rect ? event.clientY > rect.top + rect.height / 2 : false;
    const insertionIndex = isAfter ? index + 1 : index;
    moveTask(columnId, insertionIndex);
  };

  const handleColumnDragOver = (columnId, tasksLength) => event => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (activeColumnId !== columnId) {
      setActiveColumnId(columnId);
    }
    if (dropIndicator?.columnId !== columnId || dropIndicator?.index !== tasksLength) {
      setDropIndicator({ columnId, index: tasksLength });
    }
  };

  const handleCardDragOver = (columnId, index) => event => {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    if (activeColumnId !== columnId) {
      setActiveColumnId(columnId);
    }
    const rect = event.currentTarget.getBoundingClientRect?.();
    const isAfter = rect ? event.clientY > rect.top + rect.height / 2 : false;
    const insertionIndex = isAfter ? index + 1 : index;
    if (dropIndicator?.columnId !== columnId || dropIndicator?.index !== insertionIndex) {
      setDropIndicator({ columnId, index: insertionIndex });
    }
  };

  const handleDropZoneDragOver = (columnId, index) => event => {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    if (activeColumnId !== columnId) {
      setActiveColumnId(columnId);
    }
    if (dropIndicator?.columnId !== columnId || dropIndicator?.index !== index) {
      setDropIndicator({ columnId, index });
    }
  };

  const handleDropZoneDrop = (columnId, index) => event => {
    event.preventDefault();
    event.stopPropagation();
    moveTask(columnId, index);
  };

  const handleMoveTaskWithinColumn = (columnId, taskId, direction) => {
    applyBoardChange(prev => {
      const tasks = prev[columnId];
      if (!Array.isArray(tasks) || tasks.length < 2) {
        return prev;
      }
      const fromIndex = tasks.findIndex(task => task.id === taskId);
      if (fromIndex === -1) {
        return prev;
      }
      const toIndex = fromIndex + direction;
      if (toIndex < 0 || toIndex >= tasks.length) {
        return prev;
      }
      const nextTasks = [...tasks];
      const [moved] = nextTasks.splice(fromIndex, 1);
      nextTasks.splice(toIndex, 0, moved);
      return { ...prev, [columnId]: nextTasks };
    });
  };

  const handleCompleteTask = (columnId, taskId) => {
    let completedTask = null;
    applyBoardChange(prev => {
      const columnTasks = prev[columnId];
      if (!Array.isArray(columnTasks)) {
        return prev;
      }
      const updatedColumn = columnTasks.filter(task => {
        if (task.id === taskId) {
          completedTask = task;
          return false;
        }
        return true;
      });
      if (updatedColumn.length === columnTasks.length) {
        return prev;
      }
      return { ...prev, [columnId]: updatedColumn };
    });

    if (completedTask) {
      const entry = {
        id: `completed-${completedTask.id}-${Date.now()}`,
        title: completedTask.title,
        project: completedTask.project,
        completedAt: Date.now()
      };
      setCompletedTasks(prev => pruneCompletedEntries([...prev, entry]));
      if (editingField?.taskId === taskId) {
        setEditingField(null);
      }
    }
  };

  const startEditingField = (columnId, taskId, field, value) => {
    setEditingField({ columnId, taskId, field, value });
  };

  const handleEditingChange = event => {
    const value = event.target.value;
    setEditingField(prev => (prev ? { ...prev, value } : prev));
  };

  const commitEditingField = valueOverride => {
    if (!editingField) {
      return;
    }

    const isEventObject =
      valueOverride && typeof valueOverride === "object" && "nativeEvent" in valueOverride;

    applyBoardChange(prev => {
      const nextValue =
        !isEventObject && valueOverride !== undefined ? valueOverride : editingField.value;
      const updatedColumn = prev[editingField.columnId].map(task =>
        task.id === editingField.taskId ? { ...task, [editingField.field]: nextValue } : task
      );
      return { ...prev, [editingField.columnId]: updatedColumn };
    });
    setEditingField(null);
  };

const cancelEditingField = () => {
  setEditingField(null);
};
const renderDetailWithLinks = text => {
  if (!text) {
    return [];
  }
  return text.split(URL_SPLIT_REGEX).map((segment, index) => {
    if (!segment) {
      return <span key={`detail-empty-${index}`} />;
    }

    if (URL_TEST_REGEX.test(segment)) {
      return (
        <a
          key={`detail-link-${index}`}
          href={segment}
          target="_blank"
          rel="noopener noreferrer"
        >
          {segment}
        </a>
      );
    }

    return (
      <span key={`detail-text-${index}`} className="detail-text">
        {segment}
      </span>
    );
  });
};

  const handleTitleKeyDown = event => {
    if (isComposingEvent(event)) {
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      cancelEditingField();
    }

    if (event.key === "Enter") {
      event.preventDefault();
      commitEditingField();
    }
  };

  const handleDetailKeyDown = event => {
    if (isComposingEvent(event)) {
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      cancelEditingField();
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      commitEditingField();
    }
  };

  const handleNewTaskDetailKeyDown = event => {
    if (event.key === "Enter" && isComposingEvent(event)) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  const showCopyToast = useCallback(message => {
    setCopyToast(message);
    if (copyToastTimerRef.current) {
      clearTimeout(copyToastTimerRef.current);
    }
    copyToastTimerRef.current = setTimeout(() => {
      setCopyToast("");
      copyToastTimerRef.current = null;
    }, 3000);
  }, []);

  const handleCopyTitle = useCallback(
    (projectLabel, titleLabel) => {
      if (typeof document === "undefined") {
        return;
      }

      const projectText = projectLabel || "案件タグなし";
      const titleText = titleLabel || "";
      const payload = `${projectText}、${titleText}`.trim();
      if (!payload) {
        return;
      }

      const fallbackCopy = () => {
        const textarea = document.createElement("textarea");
        textarea.value = payload;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        try {
          document.execCommand("copy");
        } finally {
          document.body.removeChild(textarea);
        }
      };

      const notify = () => showCopyToast("チケットタイトルがクリップボードにコピーされました");

      if (navigator?.clipboard?.writeText) {
        navigator.clipboard
          .writeText(payload)
          .then(notify)
          .catch(() => {
            fallbackCopy();
            notify();
          });
      } else {
        fallbackCopy();
        notify();
      }
    },
    [showCopyToast]
  );

  useEffect(() => {
    return () => {
      if (copyToastTimerRef.current) {
        clearTimeout(copyToastTimerRef.current);
      }
    };
  }, []);

  const handleToggleTaskFocus = (columnId, taskId) => {
    applyBoardChange(prev => {
      let targetFound = false;
      let targetWasActive = false;
      const next = Object.keys(prev).reduce((acc, key) => {
        acc[key] = prev[key].map(task => {
          const isTarget = key === columnId && task.id === taskId;
          if (isTarget) {
            targetFound = true;
            targetWasActive = Boolean(task.isActive);
          }
          return { ...task, isActive: false };
        });
        return acc;
      }, {});

      if (!targetFound) {
        return prev;
      }

      if (!targetWasActive) {
        next[columnId] = next[columnId].map(task =>
          task.id === taskId ? { ...task, isActive: true, isPaused: false } : task
        );
      }

      return next;
    });
  };

  const handleToggleTaskPaused = (columnId, taskId) => {
    applyBoardChange(prev => {
      const tasks = prev[columnId];
      if (!Array.isArray(tasks)) {
        return prev;
      }

      let changed = false;
      const nextTasks = tasks.map(task => {
        if (task.id !== taskId) {
          return task;
        }
        const isPaused = !task.isPaused;
        changed = true;
        return { ...task, isPaused, isActive: isPaused ? false : task.isActive };
      });

      return changed ? { ...prev, [columnId]: nextTasks } : prev;
    });
  };

  const handleExportCsv = useCallback(() => {
    if (typeof document === "undefined") {
      return;
    }

    const rows = [CSV_HEADERS];
    priorityColumns.forEach(column => {
      const tasks = board[column.id] ?? [];
      tasks.forEach(task => {
        rows.push([
          task.project || "",
          task.title || "",
          column.label ?? column.id,
          task.duration ? `${task.duration}分` : "",
          (task.detail || "").replace(/\r?\n/g, " "),
          task.createdAt ? new Date(task.createdAt).toISOString() : ""
        ]);
      });
    });

    const csvContent = rows
      .map(row => row.map(value => `"${String(value ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `tasks-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [board, priorityColumns]);

  const handleExportJson = useCallback(() => {
    if (typeof document === "undefined") {
      return;
    }

    const payload = {
      board,
      projects: projectOptions,
      completedTasks,
      priorityColumns,
      exportedAt: Date.now()
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json;charset=utf-8;"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `tasks-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [board, projectOptions, completedTasks, priorityColumns]);

  const handleImportJson = event => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = loadEvent => {
      try {
        const parsed = JSON.parse(loadEvent.target?.result || "{}");
        const normalized = normalizePersistedPayload(parsed);
        if (!normalized) {
          throw new Error("形式が正しくありません。");
        }

        applyBoardChange(() => normalized.board);
        setProjectOptions(normalized.projects);
        setCompletedTasks(normalized.completedTasks ?? []);
        setPriorityColumns(normalized.priorityColumns);
        window?.alert?.("JSONを読み込みました。");
      } catch (error) {
        window?.alert?.(`JSONの読み込みに失敗しました: ${error.message}`);
      } finally {
        event.target.value = "";
      }
    };
    reader.onerror = () => {
      window?.alert?.("ファイルの読み込みに失敗しました。");
      event.target.value = "";
    };
    reader.readAsText(file, "utf-8");
  };

  const triggerImportDialog = () => {
    importInputRef.current?.click();
  };

  return (
    <div className="app-shell">
      <header className="app-hero">
        <div>
          <p className="badge">Local only</p>
          <h1>My Focus Board</h1>
          <p className="subtitle">
            Trello風のタスクボード。ブラウザのローカルストレージに保存されるので、再起動してもリストはそのままです。
          </p>
        </div>
        <div className="hero-actions">
          <button type="button" className="ghost-button" onClick={handleExportJson}>
            JSON出力
          </button>
          <button type="button" className="ghost-button" onClick={triggerImportDialog}>
            JSON読み込み
          </button>
          <button type="button" className="ghost-button" onClick={handleExportCsv}>
            CSV出力
          </button>
          <div className="task-count">
            <strong>{totalTasks}</strong>
            <span>tasks</span>
          </div>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json"
            style={{ display: "none" }}
            onChange={handleImportJson}
          />
        </div>
      </header>

      <div className="summary-row">
        <section className="completed-strip">
          <div className="completed-header">
            <div>直近24時間で完了</div>
            <span className="completed-count">{recentCompleted.length}</span>
          </div>
          <div className="completed-list">
            {recentCompleted.length > 0 ? (
              recentCompleted
                .slice()
                .reverse()
                .map(entry => (
                  <div key={entry.id} className="completed-chip">
                    <span className="chip-project">{entry.project || "案件タグなし"}</span>
                    <span className="chip-title">{entry.title || "（無題）"}</span>
                    <span className="chip-time">{formatRelativeTime(entry.completedAt)}</span>
                  </div>
                ))
            ) : (
              <span className="completed-empty">まだ完了タスクはありません</span>
            )}
          </div>
        </section>

        <section className="timer-panel" aria-label="作業時間タイマー">
          <div className="timer-header">作業時間タイマー</div>
          {activeTask ? (
            <>
              <div className="timer-task">
                <div className="timer-task-project">{activeTask.task.project || "案件タグなし"}</div>
                <div className="timer-task-title">{activeTask.task.title || "（無題）"}</div>
                <div className="timer-task-hint">
                  想定所要時間 {Number(activeTask.task.duration) || DURATION_OPTIONS[0]}分 から開始
                </div>
              </div>
              <div className={`timer-clock ${activeTimerSignedSeconds < 0 ? "overtime" : ""}`}>
                {formattedWorkTimer ?? "00:00"}
              </div>
            </>
          ) : (
            <div className="timer-empty">
              チケットをダブルクリックして黄色にすると、想定所要時間からタイマーがスタートします。
            </div>
          )}
        </section>
      </div>

      <section className="create-panel">
        <form className="create-form" onSubmit={handleAddTask}>
          <div className="field-grid">
            <label className="field field-two-third">
              <span>タイトル</span>
              <input
                type="text"
                value={newTask.title}
                placeholder="例：お客様向けデモの準備"
                onChange={event => setNewTask({ ...newTask, title: event.target.value })}
                required
              />
            </label>
            <div className="field field-one-third priority-select">
              <span>優先度</span>
              <div className="priority-chips">
                {priorityColumns.map(column => {
                  const isActive = newTask.priority === column.id;
                  const isEditing =
                    editingColumn?.columnId === column.id &&
                    editingColumn?.field === "label" &&
                    editingColumn?.source === "form";
                  if (isEditing) {
                    return (
                      <input
                        key={column.id}
                        className="chip-inline-input"
                        value={editingColumn.value}
                        autoFocus
                        aria-label={`${column.label} の優先度名を編集`}
                        onChange={event =>
                          setEditingColumn(prev => ({ ...prev, value: event.target.value }))
                        }
                        onBlur={commitEditingColumn}
                        onKeyDown={handleInlineEditKeyDown(commitEditingColumn)}
                      />
                    );
                  }
                  return (
                    <button
                      type="button"
                      key={column.id}
                      className={`priority-chip ${isActive ? "active" : ""}`}
                      onClick={() => setNewTask({ ...newTask, priority: column.id })}
                      onDoubleClick={event => {
                        event.preventDefault();
                        startEditingColumn(column, "label", "form");
                      }}
                      title="ダブルクリックで編集"
                    >
                      {column.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <label className="field field-two-third">
              <span>メモ</span>
              <textarea
                value={newTask.detail}
                placeholder="進め方やメモがあれば書いておく"
                rows={2}
                onKeyDown={handleNewTaskDetailKeyDown}
                onChange={event => setNewTask({ ...newTask, detail: event.target.value })}
              />
            </label>
          </div>

          <div className="secondary-grid">
            <div className="project-manager">
              <div className="project-header">
                <span className="field-label">案件タグ</span>
                {newTask.project && (
                  <span className="project-selected">選択中：{newTask.project}</span>
                )}
              </div>
              <div className="project-chips">
                {projectOptions.map(option => {
                  const isActive = newTask.project === option;
                  if (editingProject?.original === option) {
                    return (
                      <input
                        key={option}
                        className="chip-inline-input project-chip-input"
                        value={editingProject.value}
                        autoFocus
                        aria-label={`${option} の案件タグ名を編集`}
                        onChange={event =>
                          setEditingProject(prev => ({ ...prev, value: event.target.value }))
                        }
                        onBlur={commitEditingProject}
                        onKeyDown={handleInlineEditKeyDown(commitEditingProject)}
                      />
                    );
                  }
                  return (
                    <span
                      className={`project-chip-group ${draggedProject === option ? "dragging" : ""}`}
                      key={option}
                      draggable
                      onDragStart={handleProjectDragStart(option)}
                      onDragOver={handleProjectDragOver}
                      onDrop={handleProjectDrop(option)}
                      onDragEnd={() => setDraggedProject(null)}
                    >
                      <button
                        type="button"
                        className={`project-chip ${isActive ? "active" : ""}`}
                        onClick={() => setNewTask({ ...newTask, project: option })}
                        onDoubleClick={event => {
                          event.preventDefault();
                          startEditingProject(option);
                        }}
                        title="ダブルクリックで編集"
                      >
                        {option}
                        <span
                          className="chip-remove"
                          role="button"
                          aria-label={`${option} を削除`}
                          onClick={event => {
                            event.stopPropagation();
                            handleRemoveProjectOption(option);
                          }}
                        >
                          ×
                        </span>
                      </button>
                    </span>
                  );
                })}
                {projectOptions.length === 0 && (
                  <span className="option-helper">タグを追加してここから選択してください</span>
                )}
              </div>
              <div className="option-edit">
                <input
                  type="text"
                  value={projectDraft}
                  placeholder="案件名を追加"
                  onChange={event => setProjectDraft(event.target.value)}
                />
                <button type="button" className="option-add" onClick={handleAddProjectOption}>
                  追加
                </button>
              </div>
            </div>

            <div className="duration-select">
              <span className="field-label">想定所要時間</span>
              <div className="duration-chips">
                {DURATION_OPTIONS.map(option => {
                  const isActive = newTask.duration === option;
                  return (
                    <button
                      type="button"
                      key={option}
                      className={`duration-chip ${isActive ? "active" : ""}`}
                      onClick={() => setNewTask({ ...newTask, duration: option })}
                    >
                      {option}分
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="form-actions">
              <button type="submit" className="primary-button">
                タスクを追加
              </button>
            </div>
          </div>
        </form>
      </section>

      <main className="board">
        {priorityColumns.map(column => {
          const tasks = board[column.id] ?? [];
          return (
            <section
              key={column.id}
              className={`column ${activeColumnId === column.id ? "column-active" : ""}`}
              onDragOver={handleColumnDragOver(column.id, tasks.length)}
              onDrop={handleColumnDrop(column.id)}
            >
              <header>
                <div className="column-label">
                  <span className="swatch" style={{ backgroundColor: column.accent }} />
                  <div>
                    {editingColumn?.columnId === column.id &&
                    editingColumn?.field === "label" &&
                    editingColumn?.source === "board" ? (
                      <input
                        className="column-inline-input column-title-input"
                        value={editingColumn.value}
                        autoFocus
                        onChange={event =>
                          setEditingColumn(prev => ({ ...prev, value: event.target.value }))
                        }
                        onBlur={commitEditingColumn}
                        onKeyDown={handleInlineEditKeyDown(commitEditingColumn)}
                      />
                    ) : (
                      <h2 onDoubleClick={() => startEditingColumn(column, "label")} title="ダブルクリックで編集">
                        {column.label}
                      </h2>
                    )}
                    {editingColumn?.columnId === column.id && editingColumn?.field === "description" ? (
                      <input
                        className="column-inline-input column-description-input"
                        value={editingColumn.value}
                        autoFocus
                        onChange={event =>
                          setEditingColumn(prev => ({ ...prev, value: event.target.value }))
                        }
                        onBlur={commitEditingColumn}
                        onKeyDown={handleInlineEditKeyDown(commitEditingColumn)}
                      />
                    ) : (
                      <p
                        onDoubleClick={() => startEditingColumn(column, "description")}
                        title="ダブルクリックで編集"
                      >
                        {column.description}
                      </p>
                    )}
                  </div>
                </div>
                <span className="column-count">{tasks.length}</span>
              </header>

              <div className="card-stack">
                <div
                  className="drop-zone"
                  onDragOver={handleDropZoneDragOver(column.id, 0)}
                  onDrop={handleDropZoneDrop(column.id, 0)}
                  aria-hidden="true"
                >
                  {dropIndicator?.columnId === column.id && dropIndicator?.index === 0 && (
                    <div className="drop-marker" />
                  )}
                </div>
                {tasks.map((task, index) => {
                  const isEditingThisTask =
                    editingField?.taskId === task.id && editingField?.columnId === column.id;
                  const isEditingTitle = isEditingThisTask && editingField?.field === "title";
                  const isEditingDetail = isEditingThisTask && editingField?.field === "detail";
                  const isEditingProject = isEditingThisTask && editingField?.field === "project";
                  const isEditingDuration = isEditingThisTask && editingField?.field === "duration";
                  const normalizedDuration = Number(task.duration) || DURATION_OPTIONS[0];
                  const currentProject = task.project ?? "";
                  const isFirst = index === 0;
                  const isLast = index === tasks.length - 1;
                  const dropZoneIndex = index + 1;

                  return (
                    <Fragment key={task.id}>
                      <article
                        className={`task-card ${task.isPaused ? "task-paused" : ""} ${
                          task.isActive ? "task-active" : ""
                        }`}
                        draggable={!isEditingThisTask}
                        onDragStart={handleDragStart(column.id, task.id)}
                        onDragEnd={handleDragEnd}
                        onDragOver={handleCardDragOver(column.id, index)}
                        onDrop={handleCardDrop(column.id, index)}
                        onDoubleClick={event => {
                          event.stopPropagation();
                          handleToggleTaskFocus(column.id, task.id);
                        }}
                      >
                        <div className="task-headline">
                          <div className="task-info">
                            {isEditingTitle ? (
                              <input
                                className="inline-input"
                                value={editingField?.value ?? ""}
                                autoFocus
                                onChange={handleEditingChange}
                                onBlur={() => commitEditingField()}
                                onKeyDown={handleTitleKeyDown}
                              />
                            ) : (
                              <h3
                                onDoubleClick={event => {
                                  event.stopPropagation();
                                  startEditingField(column.id, task.id, "title", task.title);
                                }}
                              >
                                {task.title}
                              </h3>
                            )}
                            <div className="task-tags">
                              {isEditingProject ? (
                                <select
                                  className="inline-select"
                                  autoFocus
                                  value={editingField?.value ?? currentProject}
                                  onChange={event => commitEditingField(event.target.value)}
                                  onBlur={cancelEditingField}
                                >
                                  <option value="">案件タグなし</option>
                                  {projectOptions.map(option => (
                                    <option key={option} value={option}>
                                      {option}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <button
                                  type="button"
                                  className={`task-project ${currentProject ? "" : "placeholder"}`}
                                  onClick={event => {
                                    event.stopPropagation();
                                    startEditingField(column.id, task.id, "project", currentProject);
                                  }}
                                >
                                  {currentProject || "案件タグを設定"}
                                </button>
                              )}
                              {isEditingDuration ? (
                                <select
                                  className="inline-select"
                                  autoFocus
                                  value={String(editingField?.value ?? normalizedDuration)}
                                  onChange={event => commitEditingField(Number(event.target.value))}
                                  onBlur={cancelEditingField}
                                >
                                  {DURATION_OPTIONS.map(option => (
                                    <option key={option} value={option}>
                                      約{option}分
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <button
                                  type="button"
                                  className="task-duration"
                                  onClick={event => {
                                    event.stopPropagation();
                                    startEditingField(column.id, task.id, "duration", normalizedDuration);
                                  }}
                                >
                                  約{normalizedDuration}分
                                </button>
                              )}
                              <button
                                type="button"
                                className={`task-memo ${task.detail ? "" : "placeholder"}`}
                                aria-label="メモ"
                                onClick={event => {
                                  event.stopPropagation();
                                  startEditingField(column.id, task.id, "detail", task.detail);
                                }}
                              >
                                <svg
                                  className="memo-icon"
                                  width="14"
                                  height="14"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  xmlns="http://www.w3.org/2000/svg"
                                  aria-hidden="true"
                                >
                                  <path
                                    d="M4 20h4l10.5-10.5a2.121 2.121 0 0 0 0-3L16.5 4.5a2.121 2.121 0 0 0-3 0L3 15v5z"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                  <path
                                    d="M13.5 6.5l4 4"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </svg>
                                <span className="memo-tooltip" role="tooltip">
                                  {task.detail ? renderDetailWithLinks(task.detail) : "メモなし"}
                                </span>
                              </button>
                            </div>
                          </div>
                          <div className="task-actions">
                            <button
                              type="button"
                              className="move-button"
                              aria-label="上に移動"
                              disabled={isFirst}
                              onClick={event => {
                                event.stopPropagation();
                                handleMoveTaskWithinColumn(column.id, task.id, -1);
                              }}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              className="move-button"
                              aria-label="下に移動"
                              disabled={isLast}
                              onClick={event => {
                                event.stopPropagation();
                                handleMoveTaskWithinColumn(column.id, task.id, 1);
                              }}
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              className="copy-button"
                              aria-label="タイトルをコピー"
                              onClick={event => {
                                event.stopPropagation();
                                handleCopyTitle(currentProject, task.title);
                              }}
                            >
                              <svg
                                width="14"
                                height="14"
                                viewBox="0 0 24 24"
                                fill="none"
                                xmlns="http://www.w3.org/2000/svg"
                                aria-hidden="true"
                              >
                                <path
                                  d="M9 3H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                                <rect
                                  x="9"
                                  y="7"
                                  width="12"
                                  height="14"
                                  rx="2"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                            </button>
                            <button
                              type="button"
                              className={`pause-button ${task.isPaused ? "active" : ""}`}
                              aria-label={task.isPaused ? "中断を解除" : "中断にする"}
                              title={task.isPaused ? "中断を解除" : "中断にする"}
                              aria-pressed={task.isPaused}
                              onClick={event => {
                                event.stopPropagation();
                                handleToggleTaskPaused(column.id, task.id);
                              }}
                            >
                              <svg
                                width="14"
                                height="14"
                                viewBox="0 0 24 24"
                                fill="none"
                                xmlns="http://www.w3.org/2000/svg"
                                aria-hidden="true"
                              >
                                <path
                                  d="M8 5v14M16 5v14"
                                  stroke="currentColor"
                                  strokeWidth="3"
                                  strokeLinecap="round"
                                />
                              </svg>
                            </button>
                            <button
                              type="button"
                              className="complete-button"
                              aria-label="タスクを完了"
                              onClick={event => {
                                event.stopPropagation();
                                handleCompleteTask(column.id, task.id);
                              }}
                            >
                              <svg
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                                xmlns="http://www.w3.org/2000/svg"
                                aria-hidden="true"
                              >
                                <path
                                  d="M5 13l4 4L19 7"
                                  stroke="currentColor"
                                  strokeWidth="2.5"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                            </button>
                          </div>
                        </div>
                        {isEditingDetail && (
                          <textarea
                            className="inline-textarea"
                            rows={3}
                            autoFocus
                            value={editingField?.value ?? ""}
                            onChange={handleEditingChange}
                            onBlur={() => commitEditingField()}
                            onKeyDown={handleDetailKeyDown}
                          />
                        )}
                      </article>
                      <div
                        className="drop-zone"
                        onDragOver={handleDropZoneDragOver(column.id, dropZoneIndex)}
                        onDrop={handleDropZoneDrop(column.id, dropZoneIndex)}
                        aria-hidden="true"
                      >
                        {dropIndicator?.columnId === column.id &&
                          dropIndicator?.index === dropZoneIndex && <div className="drop-marker" />}
                      </div>
                    </Fragment>
                  );
                })}
                {tasks.length === 0 && (
                  <div className="empty-card">ここにタスクをドラッグまたは追加してください</div>
                )}
              </div>
            </section>
          );
        })}
      </main>
      <div className={`copy-toast ${copyToast ? "visible" : ""}`} aria-live="polite">
        {copyToast}
      </div>
    </div>
  );
}

const UNITS = [
  { label: "日前", value: 1000 * 60 * 60 * 24 },
  { label: "時間前", value: 1000 * 60 * 60 },
  { label: "分前", value: 1000 * 60 },
  { label: "秒前", value: 1000 }
];

const formatRelativeTime = timestamp => {
  if (!timestamp) {
    return "さきほど";
  }

  const diff = Date.now() - Number(timestamp);
  if (diff <= 0) {
    return "さきほど";
  }

  const unit = UNITS.find(item => diff >= item.value);
  if (!unit) {
    return "さきほど";
  }

  const amount = Math.floor(diff / unit.value);
  return `${amount}${unit.label}`;
};

export default App;
