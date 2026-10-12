import pytest

from fake_hou import FakeHipFile, FakeHou
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
