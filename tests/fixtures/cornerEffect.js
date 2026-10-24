// Isolated test double: never creates a GPU context or contacts Shell.
export class CornerEffect {
    update(geometry) { this.geometry = geometry; }
}
