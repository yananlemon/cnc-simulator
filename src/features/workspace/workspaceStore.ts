import { create } from "zustand";

interface WorkspaceState {
  fileName: string;
  gcode: string;
  isLoading: boolean;
  isGcodeDrawerOpen: boolean;
  isHelpOpen: boolean;
}

interface WorkspaceActions {
  setFileName: (name: string) => void;
  setGcode: (gcode: string) => void;
  setIsLoading: (v: boolean) => void;
  setIsGcodeDrawerOpen: (v: boolean) => void;
  setIsHelpOpen: (v: boolean) => void;
  resetWorkspace: () => void;
}

export type WorkspaceStore = WorkspaceState & WorkspaceActions;

const initialState: WorkspaceState = {
  fileName: "未导入文件",
  gcode: "",
  isLoading: false,
  isGcodeDrawerOpen: false,
  isHelpOpen: false,
};

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  ...initialState,
  setFileName: (fileName) => set({ fileName }),
  setGcode: (gcode) => set({ gcode }),
  setIsLoading: (isLoading) => set({ isLoading }),
  setIsGcodeDrawerOpen: (isGcodeDrawerOpen) => set({ isGcodeDrawerOpen }),
  setIsHelpOpen: (isHelpOpen) => set({ isHelpOpen }),
  resetWorkspace: () => set(initialState),
}));
