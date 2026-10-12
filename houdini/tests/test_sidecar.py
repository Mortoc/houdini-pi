from pathlib import Path

import pytest

from houdini_pi import sidecar


def test_port_stays_in_the_reserved_span():
    assert sidecar.derive_port(0) == 9100
    assert sidecar.derive_port(399) == 9499
    assert sidecar.derive_port(400) == 9100
    assert sidecar.derive_port(123456) == 9100 + (123456 % 400)


def test_probe_health_only_accepts_our_sidecar():
    assert sidecar.probe_health(1, lambda url: {"ok": True, "pid": 1, "houdiniPort": 8100}) is not None
    assert sidecar.probe_health(1, lambda url: {"status": "ok"}) is None
    assert sidecar.probe_health(1, lambda url: None) is None


def test_missing_node_and_unbuilt_sidecar_are_named(tmp_path: Path):
    with pytest.raises(sidecar.SidecarError, match="node is not on PATH"):
        sidecar.find_node(lambda name: None)
    with pytest.raises(sidecar.SidecarError, match="sidecar is not built"):
        sidecar.sidecar_entry(tmp_path)


def test_spawn_builds_the_launch_argv_detached(tmp_path: Path, monkeypatch):
    entry = tmp_path / "sidecar" / "dist" / "src" / "index.js"
    entry.parent.mkdir(parents=True)
    entry.write_text("")
    monkeypatch.setattr(sidecar, "STATE_DIR", tmp_path / "state")
    seen = {}

    def popen(argv, **kwargs):
        seen["argv"] = argv
        seen["kwargs"] = kwargs

    argv = sidecar.spawn(9123, 8101, 4242, "tok", tmp_path, popen=popen, which=lambda n: "/usr/bin/node")
    assert argv == ["/usr/bin/node", str(entry), "--port", "9123", "--houdini-port", "8101", "--parent-pid", "4242", "--token", "tok"]
    assert seen["kwargs"]["start_new_session"] is True
    assert seen["kwargs"]["cwd"] == str(tmp_path)


def test_ensure_sidecar_reuses_a_running_one_for_this_houdini(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(sidecar, "STATE_DIR", tmp_path)
    port = sidecar.derive_port(4242)
    (tmp_path / f"sidecar-{port}.token").write_text("saved\n")
    spawned = []
    url = sidecar.ensure_sidecar(4242, 8100, tmp_path, probe=lambda p: {"ok": True, "houdiniPort": 8100} if p == port else None, spawner=lambda *a: spawned.append(a))
    assert url == f"http://127.0.0.1:{port}/?token=saved"
    assert spawned == []


def test_ensure_sidecar_skips_a_port_another_houdini_holds_and_spawns(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(sidecar, "STATE_DIR", tmp_path)
    port = sidecar.derive_port(4242)
    alive = set()

    def probe(p):
        if p == port:
            return {"ok": True, "houdiniPort": 8101}
        return {"ok": True, "houdiniPort": 8100} if p in alive else None

    def spawner(p, houdini_port, pid, token, root):
        alive.add(p)
        assert (houdini_port, pid, root) == (8100, 4242, tmp_path)

    url = sidecar.ensure_sidecar(4242, 8100, tmp_path, probe=probe, spawner=spawner, sleep=lambda s: None)
    assert url.startswith(f"http://127.0.0.1:{port + 1}/?token=")
    assert (tmp_path / f"sidecar-{port + 1}.token").read_text() == url.split("token=")[1]


def test_ensure_sidecar_fails_loudly_when_the_child_never_answers(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(sidecar, "STATE_DIR", tmp_path)
    with pytest.raises(sidecar.SidecarError, match="did not answer"):
        sidecar.ensure_sidecar(1, 8100, tmp_path, probe=lambda p: None, spawner=lambda *a: None, sleep=lambda s: None, attempts=3)
