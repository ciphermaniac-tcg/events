"""Finds a node in a `uiautomator dump` and prints the centre of its bounds.

Usage: ui.py <dump.xml> text <text>    a node whose text or description is <text>
       ui.py <dump.xml> class <class>  the first node of that class
Exits 1 when no node matches.
"""

import re
import sys
import xml.etree.ElementTree as ET


def matches(node, by, value):
    if by == "class":
        return node.get("class") == value
    return value in (node.get("text", "").strip(), node.get("content-desc", "").strip())


def centre(bounds):
    left, top, right, bottom = map(int, re.findall(r"\d+", bounds))
    return (left + right) // 2, (top + bottom) // 2


def main():
    path, by, value = sys.argv[1:4]
    for node in ET.parse(path).iter("node"):
        if matches(node, by, value):
            print(*centre(node.get("bounds")))
            return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
