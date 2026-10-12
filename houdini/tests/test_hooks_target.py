import pytest

from fake_hou import FakeHipFile, FakeHou, FakeNodeTab, FakePaneTab, FakeUI
from houdini_pi import hooks_target


@pytest.fixture
def hou():
    fake = FakeHou()
    hooks_target.set_hou(fake)
    yield fake
    if hooks_target.turn_is_open():
        hooks_target.end_turn()
    hooks_target.set_hou(None)


def test_scene_context_reports_hip_selection_and_frame(hou):
    context = hooks_target.scene_context()
    assert context["hip"] == "/scenes/rock.hip"
    assert context["selected"] == [{"path": "/obj/geo1/wire1", "type": "wire"}]
    assert context["frame"] == 12.0
    assert context["current_network"] is None  # no hou.ui outside a GUI session


def test_untitled_unsaved_scene_has_no_hip(hou):
    hou.hipFile = FakeHipFile("/tmp/untitled.hip", "untitled.hip", unsaved=False)
    assert hooks_target.scene_context()["hip"] is None


def test_turn_opens_one_group_and_closes_it_once(hou):
    hooks_target.begin_turn("houdini-pi: thinner wires")
    assert hooks_target.turn_is_open()
    assert hooks_target.end_turn() == {"closed": True}
    assert hooks_target.end_turn() == {"closed": False}
    assert hou.undos.log == ["enter:houdini-pi: thinner wires", "exit:houdini-pi: thinner wires"]


def test_begin_turn_twice_closes_the_stale_group_first(hou):
    hooks_target.begin_turn("a")
    hooks_target.begin_turn("b")
    hooks_target.end_turn()
    assert hou.undos.log == ["enter:a", "exit:a", "enter:b", "exit:b"]


def test_memory_round_trips_through_root_user_data(hou):
    assert hooks_target.memory_read() == {"text": "", "prev": None}
    hooks_target.memory_write("# Memory\n- metres\n", None)
    assert hou.root.user_data == {hooks_target.MEMORY_KEY: "# Memory\n- metres\n"}
    hooks_target.memory_write("condensed", "# Memory\n- metres\n")
    assert hooks_target.memory_read() == {"text": "condensed", "prev": "# Memory\n- metres\n"}
    hooks_target.memory_write("# Memory\n- metres\n", None)
    assert hooks_target.MEMORY_PREV_KEY not in hou.root.user_data


def test_backup_writes_a_houdini_backup_unless_untitled(hou):
    assert hooks_target.backup_scene() == {"path": "/scenes/backup/rock_bak1.hip"}
    hou.hipFile = FakeHipFile("/tmp/untitled.hip", "untitled.hip", unsaved=False)
    assert hooks_target.backup_scene() == {"skipped": "untitled scene"}


def test_follow_selects_the_last_node_and_drives_linked_panes(hou):
    hou.ui = FakeUI()
    pi_tab = FakePaneTab(hou.paneTabType.PythonPanel, hou.paneLinkType.Group2, interface="houdini_pi")
    network = FakeNodeTab(hou.paneTabType.NetworkEditor, hou.paneLinkType.Group2)
    parms = FakeNodeTab(hou.paneTabType.Parm, hou.paneLinkType.Group2)
    other = FakeNodeTab(hou.paneTabType.NetworkEditor, hou.paneLinkType.Group1)
    viewer = FakePaneTab(hou.paneTabType.SceneViewer, hou.paneLinkType.Group2)
    hou.ui.tabs = [pi_tab, network, parms, other, viewer]
    hou.add_node("/obj/geo2", "geo", hou.nodes["/obj"])

    report = hooks_target.follow_nodes(["/obj/geo1/wire1", "/obj/geo2", "/obj/missing"])

    assert report == {"followed": "/obj/geo2", "panes": 2}
    assert hou.nodes["/obj/geo2"].selected is True
    assert network.pwd is hou.nodes["/obj"] and network.current is hou.nodes["/obj/geo2"]
    assert parms.current is hou.nodes["/obj/geo2"]
    assert other.current is None


def test_follow_without_a_link_group_only_selects(hou):
    hou.ui = FakeUI()
    hou.ui.tabs = [
        FakePaneTab(hou.paneTabType.PythonPanel, hou.paneLinkType.FollowSelection, interface="houdini_pi"),
        FakeNodeTab(hou.paneTabType.NetworkEditor, hou.paneLinkType.FollowSelection),
    ]
    report = hooks_target.follow_nodes(["/obj/geo1/wire1"])
    assert report == {"followed": "/obj/geo1/wire1", "panes": 0}
    assert hou.nodes["/obj/geo1/wire1"].selected is True
    assert hooks_target.follow_nodes(["/nope"]) == {"followed": None, "panes": 0}
