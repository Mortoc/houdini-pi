from houdini_pi import drops


def test_decodes_houdini_parm_and_node_payloads_in_order():
    data = {
        "application/sidefx-houdini-node.path": b"/obj/geo1\t/obj/geo2",
        "application/sidefx-houdini-parm.path": b"/obj/geo1/wire1/radius",
        "text/plain": "/obj/geo1 not/a/path",
    }
    assert drops.paths_from_mime(data) == ["/obj/geo1/wire1/radius", "/obj/geo1", "/obj/geo2"]


def test_ignores_unknown_types_and_junk():
    assert drops.paths_from_mime({"application/x-qt-image": b"\x89PNG"}) == []
    assert drops.paths_from_mime({"text/plain": "hello world"}) == []
    assert drops.is_houdini_drag(["application/sidefx-houdini-parm.path"]) is True
    assert drops.is_houdini_drag(["application/x-qt-image"]) is False
