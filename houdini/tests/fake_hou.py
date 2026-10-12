"""Just enough of hou for hooks_target: nodes with user data, selection, undo groups."""

from __future__ import annotations


class FakeType:
    def __init__(self, name: str):
        self._name = name

    def name(self) -> str:
        return self._name


class FakeNode:
    def __init__(self, path: str, type_name: str = "geo", parent: "FakeNode | None" = None):
        self._path = path
        self._type = FakeType(type_name)
        self._parent = parent
        self.user_data: dict[str, str] = {}
        self.selected = False

    def parent(self):
        return self._parent

    def setSelected(self, on: bool, clear_all_selected: bool = False):  # noqa: N802
        self.selected = on

    def path(self) -> str:
        return self._path

    def type(self) -> FakeType:
        return self._type

    def userData(self, key: str):  # noqa: N802
        return self.user_data.get(key)

    def setUserData(self, key: str, value: str):  # noqa: N802
        self.user_data[key] = value

    def destroyUserData(self, key: str):  # noqa: N802
        del self.user_data[key]


class FakeGroup:
    def __init__(self, log: list[str], label: str):
        self.log = log
        self.label = label

    def __enter__(self):
        self.log.append(f"enter:{self.label}")
        return self

    def __exit__(self, *_):
        self.log.append(f"exit:{self.label}")


class FakeUndos:
    def __init__(self):
        self.log: list[str] = []

    def group(self, label: str) -> FakeGroup:
        return FakeGroup(self.log, label)


class FakeHipFile:
    def __init__(self, path: str = "/scenes/rock.hip", basename: str = "rock.hip", unsaved: bool = False):
        self._path = path
        self._basename = basename
        self._unsaved = unsaved

    def path(self) -> str:
        return self._path

    def basename(self) -> str:
        return self._basename

    def hasUnsavedChanges(self) -> bool:  # noqa: N802
        return self._unsaved

    def saveAsBackup(self) -> str:  # noqa: N802
        self.backups = getattr(self, "backups", 0) + 1
        return f"/scenes/backup/rock_bak{self.backups}.hip"


class Enum:
    def __init__(self, name: str):
        self.name = name

    def __repr__(self):
        return self.name


class FakePaneLinkType:
    Pinned = Enum("Pinned")
    FollowSelection = Enum("FollowSelection")
    Group1 = Enum("Group1")
    Group2 = Enum("Group2")


class FakePaneTabType:
    PythonPanel = Enum("PythonPanel")
    NetworkEditor = Enum("NetworkEditor")
    Parm = Enum("Parm")
    SceneViewer = Enum("SceneViewer")


class FakeInterface:
    def __init__(self, name: str):
        self._name = name

    def name(self) -> str:
        return self._name


class FakePaneTab:
    """A pane tab with no node to follow (a scene viewer, say)."""

    def __init__(self, tab_type, link_group, interface: str | None = None):
        self._type = tab_type
        self._link = link_group
        self._interface = interface
        self.pwd = None
        self.current = None

    def type(self):
        return self._type

    def linkGroup(self):  # noqa: N802
        return self._link

    def activeInterface(self):  # noqa: N802
        return None if self._interface is None else FakeInterface(self._interface)


class FakeNodeTab(FakePaneTab):
    """A pane tab that shows a node: network editor, parameter view."""

    def setPwd(self, node):  # noqa: N802
        self.pwd = node

    def setCurrentNode(self, node, pick_node: bool = True):  # noqa: N802
        self.current = node


class FakeUI:
    def __init__(self):
        self.tabs: list[FakePaneTab] = []

    def paneTabs(self):  # noqa: N802
        return list(self.tabs)


class FakeHou:
    paneLinkType = FakePaneLinkType
    paneTabType = FakePaneTabType

    def __init__(self):
        self.root = FakeNode("/", "root")
        self.hipFile = FakeHipFile()
        self.undos = FakeUndos()
        self.nodes: dict[str, FakeNode] = {"/": self.root}
        obj = self.add_node("/obj", "objnet")
        geo = self.add_node("/obj/geo1", "geo", obj)
        self.add_node("/obj/geo1/wire1", "wire", geo)
        self.selected: list[FakeNode] = [self.nodes["/obj/geo1/wire1"]]
        self._frame = 12.0
        self.ui = None

    def add_node(self, path: str, type_name: str, parent: FakeNode | None = None) -> FakeNode:
        node = FakeNode(path, type_name, parent)
        self.nodes[path] = node
        return node

    def node(self, path: str):
        return self.nodes.get(path)

    def selectedNodes(self):  # noqa: N802
        return list(self.selected)

    def frame(self) -> float:
        return self._frame
