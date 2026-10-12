"""Just enough of hou for hooks_target: nodes with user data, selection, undo groups."""

from __future__ import annotations


class FakeType:
    def __init__(self, name: str):
        self._name = name

    def name(self) -> str:
        return self._name


class FakeNode:
    def __init__(self, path: str, type_name: str = "geo"):
        self._path = path
        self._type = FakeType(type_name)
        self.user_data: dict[str, str] = {}

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


class FakeHou:
    def __init__(self):
        self.root = FakeNode("/", "root")
        self.hipFile = FakeHipFile()
        self.undos = FakeUndos()
        self.selected: list[FakeNode] = [FakeNode("/obj/geo1/wire1", "wire")]
        self._frame = 12.0

    def node(self, path: str) -> FakeNode:
        assert path == "/"
        return self.root

    def selectedNodes(self):  # noqa: N802
        return list(self.selected)

    def frame(self) -> float:
        return self._frame
