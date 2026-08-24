import type { AppData, Task, Project, TaskStatus } from './types';

export type TaskQueryOptions = {
    status?: TaskStatus | 'all';
    projectId?: string;
    excludeStatuses?: TaskStatus[];
    includeArchived?: boolean;
    includeDeleted?: boolean;
    isFocusedToday?: boolean;
};

export type SearchTaskResult = Pick<
    Task,
    'id' | 'title' | 'status' | 'startTime' | 'dueDate' | 'projectId' | 'areaId' | 'tags' | 'contexts' | 'location'
>;

export type SearchProjectResult = Pick<Project, 'id' | 'title' | 'status' | 'areaId'>;

export const SEARCH_RESULT_LIMIT = 200;

export type SearchResults = {
    tasks: SearchTaskResult[];
    projects: SearchProjectResult[];
    limited?: boolean;
    limit?: number;
};

export interface StorageAdapter {
    getData(): Promise<AppData>;
    /** Confirms that the exact snapshot returned by getData was applied to the live store. */
    acknowledgeDataLoad?: (data: AppData) => void;
    /** Returns the authoritative persisted snapshot when the backend can provide it. */
    saveData(data: AppData): Promise<AppData | void>;
    saveTask?: (task: Task, snapshot?: AppData) => Promise<void>;
    queryTasks?: (options: TaskQueryOptions) => Promise<Task[]>;
    searchAll?: (query: string) => Promise<SearchResults>;
}

// Predeterminado dummy adapter
export const noopStorage: StorageAdapter = {
    getData: async () => ({ tasks: [], projects: [], sections: [], areas: [], people: [], settings: {} }),
    saveData: async () => { },
};
