/**
 * Make a map and return a function for checking if a key
 * is in that map.
 * IMPORTANT: all calls of this function must be prefixed with
 * \/\*#\_\_PURE\_\_\*\/
 * So that rollup can tree-shake them if necessary.
 */
// From isReservedProp:
// 制作地图并返回一个函数，用于检查地图中是否有密钥。 所有函数调用前面都要带PURE，因此rollup可以tree-shake它们
// Reutrn To isReservedProp: 返回一个函数，用于检查地图中是否有密钥
export function makeMap(
  str: string,
  expectsLowerCase?: boolean
): (key: string) => boolean {
  // 创建键类型为string，值类型为boolean的空对象
  const map: Record<string, boolean> = Object.create(null)
  // 字符串数组，去除掉,
  const list: Array<string> = str.split(',')
  // 遍历list
  for (let i = 0; i < list.length; i++) {
    // 将值赋给map
    map[list[i]] = true
  }
  return expectsLowerCase ? val => !!map[val.toLowerCase()] : val => !!map[val]
}
