package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// App struct
type App struct {
	ctx context.Context
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

// PickEpub opens a native file dialog for choosing an EPUB. Returns "" if cancelled.
func (a *App) PickEpub() (string, error) {
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Import EPUB",
		Filters: []runtime.FileFilter{
			{DisplayName: "Ebooks & documents", Pattern: "*.epub;*.fb2;*.zip;*.mobi;*.azw;*.azw3;*.prc;*.pdf;*.txt;*.md;*.html;*.htm"},
			{DisplayName: "All files", Pattern: "*"},
		},
	})
}

// PickSavePath asks where to save an export. Returns "" if cancelled.
func (a *App) PickSavePath(defaultName string) (string, error) {
	return runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "Export notes",
		DefaultFilename: defaultName,
		Filters: []runtime.FileFilter{
			{DisplayName: "Markdown (*.md)", Pattern: "*.md"},
		},
	})
}

// ReadFileB64 reads a file and returns it base64-encoded (EPUBs are binary zips).
func (a *App) ReadFileB64(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(data), nil
}

// WriteFileB64 writes base64-encoded content to disk.
func (a *App) WriteFileB64(path string, b64 string) error {
	data, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}

func storePath() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "marginalia", "store.json"), nil
}

// OpenExternal opens http/https links in the user's browser. The webview must
// never navigate away from the app, and only web schemes are allowed here.
func (a *App) OpenExternal(url string) error {
	if len(url) > 2048 {
		return errors.New("url too long")
	}
	if !(len(url) > 8 && url[:8] == "https://") && !(len(url) > 7 && url[:7] == "http://") {
		return errors.New("only http(s) links can be opened")
	}
	runtime.BrowserOpenURL(a.ctx, url)
	return nil
}

// ReadStore returns the saved library/notes JSON, or "" on first run.
func (a *App) ReadStore() (string, error) {
	p, err := storePath()
	if err != nil {
		return "", err
	}
	data, err := os.ReadFile(p)
	if errors.Is(err, os.ErrNotExist) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// WriteStore persists library/notes JSON atomically so a crash can't corrupt it.
func (a *App) WriteStore(jsonStr string) error {
	if !json.Valid([]byte(jsonStr)) {
		return errors.New("invalid store JSON")
	}
	p, err := storePath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	tmp := p + ".tmp"
	if err := os.WriteFile(tmp, []byte(jsonStr), 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, p)
}
