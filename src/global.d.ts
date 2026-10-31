// Browser APIs that are not (yet) in TypeScript's DOM lib.

interface FilePickerAcceptType {
  description?: string
  accept: Record<string, string[]>
}

interface SaveFilePickerOptions {
  suggestedName?: string
  types?: FilePickerAcceptType[]
  excludeAcceptAllOption?: boolean
  startIn?: string | FileSystemHandle
  id?: string
}

interface DirectoryPickerOptions {
  id?: string
  mode?: 'read' | 'readwrite'
  startIn?: string | FileSystemHandle
}

type PermissionMode = { mode?: 'read' | 'readwrite' }

interface FileSystemHandle {
  queryPermission?(descriptor?: PermissionMode): Promise<PermissionState>
  requestPermission?(descriptor?: PermissionMode): Promise<PermissionState>
}

interface Window {
  showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>
  showDirectoryPicker?: (options?: DirectoryPickerOptions) => Promise<FileSystemDirectoryHandle>
  documentPictureInPicture?: {
    requestWindow(options?: { width?: number; height?: number; disallowReturnToOpener?: boolean }): Promise<Window>
    window: Window | null
  }
}

interface HTMLMediaElement {
  captureStream?(): MediaStream
  mozCaptureStream?(): MediaStream
}
