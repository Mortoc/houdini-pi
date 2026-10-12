"""Just enough of hou for hooks_target: nodes with user data, selection, undo groups."""

from __future__ import annotations


class FakeCategory:
    def __init__(self, name: str):
        self._name = name

    def name(self) -> str:
        return self._name


class FakeType:
    def __init__(self, name: str, category: str = "Object"):
        self._name = name
        self._category = FakeCategory(category)

    def name(self) -> str:
        return self._name

    def category(self) -> FakeCategory:
        return self._category


class FakeParm:
    def __init__(self, owner=None):
        self.owner = owner
        self.value = None
        self.pressed = 0

    def set(self, value):
        self.value = value

    def pressButton(self):  # noqa: N802
        self.pressed += 1
        if self.owner is not None and self.owner.on_execute is not None:
            self.owner.on_execute(self.owner)


class FakeNode:
    def __init__(self, path: str, type_name: str = "geo", parent: "FakeNode | None" = None, category: str = "Object"):
        self._path = path
        self._type = FakeType(type_name, category)
        self._parent = parent
        self.user_data: dict[str, str] = {}
        self.selected = False
        self.parms: dict[str, FakeParm] = {}
        self.children_created: list["FakeNode"] = []
        self.destroyed = False
        self.on_execute = None

    def name(self) -> str:
        return self._path.rsplit("/", 1)[-1]

    def parm(self, name: str) -> FakeParm:
        return self.parms.setdefault(name, FakeParm(self))

    def parmTuple(self, name: str) -> FakeParm:  # noqa: N802
        return self.parm(name)

    def createNode(self, type_name: str, name: str) -> "FakeNode":  # noqa: N802
        child = FakeNode(f"{self._path}/{name}", type_name, self, "Cop")
        child.on_execute = self.on_execute
        self.children_created.append(child)
        return child

    def destroy(self):
        self.destroyed = True

    def errors(self):
        return ()

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


for _n in range(1, 10):
    setattr(FakePaneLinkType, f"Group{_n}", Enum(f"Group{_n}"))


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

    def setLinkGroup(self, group):  # noqa: N802
        self._link = group

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

    def add_node(self, path: str, type_name: str, parent: FakeNode | None = None, category: str = "Object") -> FakeNode:
        node = FakeNode(path, type_name, parent, category)
        self.nodes[path] = node
        return node

    def node(self, path: str):
        return self.nodes.get(path)

    def selectedNodes(self):  # noqa: N802
        return list(self.selected)

    def frame(self) -> float:
        return self._frame
