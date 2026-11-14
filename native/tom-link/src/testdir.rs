//! Throwaway folders for tests.

use std::fs;
use std::path::{Path, PathBuf};

pub(crate) struct TestDir(PathBuf);

impl TestDir {
    pub(crate) fn new() -> Self {
        let dir = std::env::temp_dir().join(format!("tom-link-test-{}", crate::random_hex(8)));
        fs::create_dir_all(&dir).unwrap();
        Self(dir)
    }

    pub(crate) fn path(&self) -> &Path {
        &self.0
    }

    /// Creates an empty file (and its folders) and returns its path.
    pub(crate) fn file(&self, relative: &str) -> PathBuf {
        let path = self.0.join(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, b"x").unwrap();
        path
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
