import { LayoutManager } from '../../LayoutManager';
import type { GroupProps } from '../../shapes/Group';
import { Group } from '../../shapes/Group';
import type { FabricObject } from '../../shapes/Object/FabricObject';

/**
 * Groups SVG elements (usually those retrieved from SVG document)
 * @static
 * @param {FabricObject[]} elements FabricObject(s) parsed from svg, to group
 * @return {FabricObject | Group}
 */
export const groupSVGElements = (
  elements: FabricObject[],
  options?: Partial<GroupProps>
) => {
  if (elements && elements.length === 1) {
    return elements[0];
  }
  return new Group(elements, {
    layoutManager: new LayoutManager(),
    ...options,
  });
};
