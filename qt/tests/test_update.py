# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock, patch

import anki.lang
import aqt
from anki.collection import GithubRelease
from aqt import update


def make_release(tag_name: str) -> GithubRelease:
    return GithubRelease(
        tag_name=tag_name,
        filename=f"anki-{tag_name}-linux-x86_64.tar.zst",
        url=f"https://example.com/anki-{tag_name}-linux-x86_64.tar.zst",
        checksum="0" * 64,
    )


def run_download(
    running_version: str,
    release: GithubRelease | None = None,
    error: Exception | None = None,
) -> tuple[MagicMock, MagicMock, dict[str, Any]]:
    """Run download_and_install_latest_release() with the release lookup
    mocked out, then deliver either `release` or `error` to its callbacks."""
    mw = MagicMock()
    op = MagicMock()
    op.failure.return_value = op
    op.with_progress.return_value = op
    with (
        patch.object(update, "version", running_version),
        patch.object(update, "get_latest_release_op", return_value=op) as get_op,
        patch.object(update, "_download_github_update_and_install") as install,
        patch.object(update, "openLink") as open_link,
    ):
        update.download_and_install_latest_release(mw)
        op.run_in_background.assert_called_once_with()
        kwargs = get_op.call_args.kwargs
        assert kwargs["parent"] is mw
        if error is not None:
            op.failure.call_args.args[0](error)
        else:
            kwargs["on_success"](release)
    return install, open_link, kwargs


def test_newer_release_is_downloaded_and_installed() -> None:
    release = make_release("26.09.2")
    install, open_link, kwargs = run_download("26.09.1", release)
    assert kwargs["include_prerelease"] is False
    install.assert_called_once_with(release)
    open_link.assert_not_called()


def test_prerelease_build_considers_prereleases() -> None:
    release = make_release("26.10b2")
    install, open_link, kwargs = run_download("26.10b1", release)
    assert kwargs["include_prerelease"] is True
    install.assert_called_once_with(release)
    open_link.assert_not_called()


def test_release_not_newer_than_running_version_opens_download_page() -> None:
    install, open_link, _ = run_download("26.09.2", make_release("26.09.2"))
    install.assert_not_called()
    open_link.assert_called_once_with(aqt.appWebsiteDownloadSection)


def test_unparseable_release_tag_opens_download_page() -> None:
    install, open_link, _ = run_download("26.09.2", make_release("not-a-version"))
    install.assert_not_called()
    open_link.assert_called_once_with(aqt.appWebsiteDownloadSection)


def test_failed_release_lookup_opens_download_page() -> None:
    install, open_link, _ = run_download("26.09.2", error=Exception("offline"))
    install.assert_not_called()
    open_link.assert_called_once_with(aqt.appWebsiteDownloadSection)


def run_prompt(*, accept: bool, ignore: bool) -> tuple[MagicMock, dict[str, Any]]:
    """Show the update prompt with QMessageBox mocked out, simulating the
    user clicking Yes/No (`accept`) or 'Ignore this update' (`ignore`)."""
    anki.lang.set_lang("en")
    mw = MagicMock()
    mw.pm.meta = {}
    with (
        patch.object(update, "QMessageBox") as msgbox_cls,
        patch.object(update, "QPushButton") as button_cls,
        patch.object(update, "download_and_install_latest_release") as download,
    ):
        msgbox = msgbox_cls.return_value
        msgbox.exec.return_value = (
            msgbox_cls.StandardButton.Yes if accept else msgbox_cls.StandardButton.No
        )
        msgbox.clickedButton.return_value = (
            button_cls.return_value if ignore else object()
        )
        update.prompt_to_update(mw, "26.09.2")
    return download, mw.pm.meta


def test_accepting_update_prompt_uses_built_in_updater() -> None:
    download, meta = run_prompt(accept=True, ignore=False)
    download.assert_called_once()
    assert "suppressUpdate" not in meta


def test_declining_update_prompt_does_nothing() -> None:
    download, meta = run_prompt(accept=False, ignore=False)
    download.assert_not_called()
    assert "suppressUpdate" not in meta


def test_ignoring_update_prompt_suppresses_version() -> None:
    download, meta = run_prompt(accept=False, ignore=True)
    download.assert_not_called()
    assert meta["suppressUpdate"] == "26.09.2"
