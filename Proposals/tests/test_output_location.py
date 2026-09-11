"""Where the app writes, and what it says when it cannot.

Shipping to a second machine produced a bare "permission denied". Root cause:
`output_dir()` was `%USERPROFILE%\Documents\EV Proposals`, but with OneDrive
folder backup on - the Microsoft 365 default - the real Documents is
`%OneDrive%\Documents` and the profile one is a redirected stub.

The installer had already learned this lesson for the Desktop shortcut
(`installer/install_app.py:desktop_dir()`); nobody applied it to Documents.
"""

from __future__ import annotations

import os
import pathlib
import tempfile

import pytest

from ev_proposal_agent import paths
from ev_proposal_agent.errors import OutputNotWritable, ProposalError


def test_documents_comes_from_the_registry_not_the_profile():
    """On a OneDrive machine these differ, and only the registry one is real."""
    docs = paths.documents_dir()
    assert docs.is_dir(), docs
    try:
        import winreg
        key = r"Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders"
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key) as h:
            raw, _ = winreg.QueryValueEx(h, "Personal")
        expected = pathlib.Path(os.path.expandvars(raw))
    except (OSError, ImportError):
        pytest.skip("no User Shell Folders registry key on this machine")
    if expected.is_dir():
        assert docs == expected


def test_output_dir_lives_under_the_real_documents():
    assert paths.output_dir().parent == paths.documents_dir()
    assert paths.output_dir().name == "EV Proposals"


def test_output_dir_falls_back_when_documents_is_unwritable(monkeypatch):
    """Defender's Controlled Folder Access blocks an unsigned exe from Documents
    with no prompt. Somewhere the operator can find beats failing outright."""
    monkeypatch.setattr(paths, "is_writable", lambda _p: False)
    monkeypatch.setenv("LOCALAPPDATA", tempfile.gettempdir())
    out = paths.output_dir()
    assert paths.documents_dir() not in out.parents
    assert out.name == "EV Proposals"


def test_is_writable_is_an_actual_probe(tmp_path):
    assert paths.is_writable(tmp_path / "made-on-demand") is True
    # A path under a file cannot be a directory, so mkdir must fail.
    blocker = tmp_path / "a-file"
    blocker.write_text("x", encoding="utf-8")
    assert paths.is_writable(blocker / "child") is False


def test_locked_output_raises_a_useful_error(best_western_path, tmp_path):
    """The commonest cause by far: the last proposal is still open in Word."""
    import msvcrt

    from ev_proposal_agent.render import generate

    out = tmp_path / "Locked.docx"
    out.write_bytes(b"placeholder")
    handle = os.open(out, os.O_RDWR | getattr(os, "O_BINARY", 0))
    try:
        msvcrt.locking(handle, msvcrt.LK_NBLCK, 1)
        with pytest.raises(OutputNotWritable) as caught:
            generate(best_western_path, output=out, progress=lambda _m: None)
    finally:
        try:
            msvcrt.locking(handle, msvcrt.LK_UNLCK, 1)
        finally:
            os.close(handle)

    message = caught.value.message
    assert "open in Word" in message            # the likeliest cause, named first
    assert "Controlled folder access" in message  # and the silent one
    assert str(out) in message                   # which file
    assert "PermissionError" in (caught.value.detail or "")
    # It must stay inside the hierarchy the GUI and CLI already catch, or the
    # operator gets a traceback instead of a sentence.
    assert isinstance(caught.value, ProposalError)


# --------------------------------------------------------------------------
# Reading the dropped workbook. This fires BEFORE anything is written, so it is
# a different failure from the output-folder one above - the app shipped saying
# only "permission denied" for both.
# --------------------------------------------------------------------------


def test_a_file_excel_holds_open_is_recovered_not_refused(best_western_path, tmp_path):
    """Windows lets us COPY a file Excel has open even when opening it in place
    is refused, so the commonest cause fixes itself instead of sending the
    operator off to close Excel."""
    import shutil

    from ev_proposal_agent.engine import load
    from ev_proposal_agent.extract import load_field_map

    book = tmp_path / "bestwesternreduction.xlsx"
    shutil.copy2(best_western_path, book)
    book.with_name("~$" + book.name).write_bytes(b"lock")   # Excel's lock file
    os.chmod(book, 0o000)                                    # refuse in-place open

    lw = load(book, load_field_map())
    assert lw.detection.chassis == "v16"


def test_missing_file_says_the_temp_copy_is_gone(tmp_path):
    from ev_proposal_agent.engine import load
    from ev_proposal_agent.extract import load_field_map
    from ev_proposal_agent.errors import WorkbookNotReadable

    with pytest.raises(WorkbookNotReadable) as caught:
        load(tmp_path / "never-existed.xlsx", load_field_map())
    assert "not there any more" in caught.value.message
    assert "Outlook" in caught.value.message


def test_a_folder_is_named_as_a_folder(tmp_path):
    from ev_proposal_agent.engine import load
    from ev_proposal_agent.extract import load_field_map
    from ev_proposal_agent.errors import WorkbookNotReadable

    d = tmp_path / "book.xlsx"
    d.mkdir()
    with pytest.raises(WorkbookNotReadable) as caught:
        load(d, load_field_map())
    assert "a folder, not a spreadsheet" in caught.value.message


def test_outlook_attachment_path_is_recognised(best_western_path, tmp_path):
    """A bare "is it under %TEMP%" test mislabels anything a user keeps there,
    so only the folders Outlook and the zip viewer actually use count."""
    import shutil

    from ev_proposal_agent.errors import WorkbookNotReadable

    nested = tmp_path / "Content.Outlook" / "9XZQ1"
    nested.mkdir(parents=True)
    book = nested / "bestwesternreduction.xlsx"
    shutil.copy2(best_western_path, book)

    err = WorkbookNotReadable.diagnose(book, PermissionError(13, "Permission denied"))
    assert "email or a zip" in err.message

    # A plain temp path must NOT trigger it.
    plain = tmp_path / "bestwesternreduction.xlsx"
    shutil.copy2(best_western_path, plain)
    assert "email or a zip" not in WorkbookNotReadable.diagnose(
        plain, PermissionError(13, "Permission denied")).message


def test_every_clue_path_stays_inside_the_error_hierarchy(tmp_path):
    """The GUI and CLI only catch ProposalError; anything else shows a traceback."""
    from ev_proposal_agent.errors import ProposalError, WorkbookNotReadable

    err = WorkbookNotReadable.diagnose(tmp_path / "gone.xlsx", OSError("boom"))
    assert isinstance(err, ProposalError)
    assert err.message and err.detail
