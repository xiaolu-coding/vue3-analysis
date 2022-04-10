import { makeMap } from './makeMap'

export { makeMap }
export * from './patchFlags'
export * from './shapeFlags'
export * from './slotFlags'
export * from './globalsWhitelist'
export * from './codeframe'
export * from './normalizeProp'
export * from './domTagConfig'
export * from './domAttrConfig'
export * from './escapeHtml'
export * from './looseEqual'
export * from './toDisplayString'
export * from './typeUtils'

export const EMPTY_OBJ: { readonly [key: string]: any } = __DEV__
  ? Object.freeze({})
  : {}
export const EMPTY_ARR = __DEV__ ? Object.freeze([]) : []

export const NOOP = () => {}

/**
 * Always return false.
 */
export const NO = () => false

const onRE = /^on[^a-z]/
export const isOn = (key: string) => onRE.test(key)

export const isModelListener = (key: string) => key.startsWith('onUpdate:')
// From shallowReactiveHandlers:
// Return To shallowReactiveHandlers: 就是调用Object.assign方法，合并对象
export const extend = Object.assign

export const remove = <T>(arr: T[], el: T) => {
  const i = arr.indexOf(el)
  if (i > -1) {
    arr.splice(i, 1)
  }
}
// From hasOwn:
// Return To hasOwn: Object.prototype.hasOwnProperty
const hasOwnProperty = Object.prototype.hasOwnProperty
// From createGetter:
// To hasOwnProperty: 
// Return From hasOwnProperty: Object.prototype.hasOwnProperty
// Return To createGetter: 判断对象是否有指定的属性
export const hasOwn = (
  val: object,
  key: string | symbol
): key is keyof typeof val => hasOwnProperty.call(val, key)
// From createGetter:
// Return To createGetter: 返回Array.isArray 判断是否是数组类型
export const isArray = Array.isArray
export const isMap = (val: unknown): val is Map<any, any> =>
  toTypeString(val) === '[object Map]'
export const isSet = (val: unknown): val is Set<any> =>
  toTypeString(val) === '[object Set]'

export const isDate = (val: unknown): val is Date => val instanceof Date
export const isFunction = (val: unknown): val is Function =>
  typeof val === 'function'
export const isString = (val: unknown): val is string => typeof val === 'string'
// From createGetter:
// Return To createGetter: 判断是否是symbol类型
export const isSymbol = (val: unknown): val is symbol => typeof val === 'symbol'
// From createGetter:
// Return To createGetter: 判断是否是对象类型
export const isObject = (val: unknown): val is Record<any, any> =>
  val !== null && typeof val === 'object'

export const isPromise = <T = any>(val: unknown): val is Promise<T> => {
  return isObject(val) && isFunction(val.then) && isFunction(val.catch)
}

export const objectToString = Object.prototype.toString
export const toTypeString = (value: unknown): string =>
  objectToString.call(value)
// From getTargetType:
// Return To getTargetType: 从“[object RawType]”之类的字符串中提取“RawType”
export const toRawType = (value: unknown): string => {
  // extract "RawType" from strings like "[object RawType]"
  // 从“[object RawType]”之类的字符串中提取“RawType”
  return toTypeString(value).slice(8, -1)
}

export const isPlainObject = (val: unknown): val is object =>
  toTypeString(val) === '[object Object]'
// From createSetter createGetter:
// Return To createSetter createGetter: 判断是否是字符串类型的正整数
export const isIntegerKey = (key: unknown) =>
  isString(key) &&
  key !== 'NaN' &&
  key[0] !== '-' &&
  '' + parseInt(key, 10) === key
// From setFullProps:
// To makeMap:
// Return From makeMap: 返回一个函数，用于检查地图中是否有密钥。
// Return To setFullProps: 所以isReservedProp就是判断那些值是否在这个makeMap的参数中
export const isReservedProp = /*#__PURE__*/ makeMap(
  // the leading comma is intentional so empty string "" is also included
  // 前导逗号是故意的，因此还包括空字符串“”
  ',key,ref,ref_for,ref_key,' +
    'onVnodeBeforeMount,onVnodeMounted,' +
    'onVnodeBeforeUpdate,onVnodeUpdated,' +
    'onVnodeBeforeUnmount,onVnodeUnmounted'
)

export const isBuiltInDirective = /*#__PURE__*/ makeMap(
  'bind,cloak,else-if,else,for,html,if,model,on,once,pre,show,slot,text,memo'
)
// From camelize:
// Return To camelize: 正则检测出-并将-后面的字符转大写
const cacheStringFunction = <T extends (str: string) => string>(fn: T): T => {
  // 创建一个键类型为string，值类型为string的空对象cache
  const cache: Record<string, string> = Object.create(null)
  // 返回一个函数，此函数返回传入的函数fn fn是camelize内部传入的正则检测出-并将-后面的字符转大写
  return ((str: string) => {
    const hit = cache[str]
    return hit || (cache[str] = fn(str))
  }) as any
}

const camelizeRE = /-(\w)/g
/**
 * @private
 */
// From setFullProps: 
// To cacheStringFunction:
// Return From cacheStringFunction: 正则检测出-并将-后面的字符转大写
// Return To setFullProps: 正则检测出-并将-后面的字符转大写
export const camelize = cacheStringFunction((str: string): string => {
  return str.replace(camelizeRE, (_, c) => (c ? c.toUpperCase() : ''))
})

const hyphenateRE = /\B([A-Z])/g
/**
 * @private
 */
export const hyphenate = cacheStringFunction((str: string) =>
  str.replace(hyphenateRE, '-$1').toLowerCase()
)

/**
 * @private
 */
export const capitalize = cacheStringFunction(
  (str: string) => str.charAt(0).toUpperCase() + str.slice(1)
)

/**
 * @private
 */
export const toHandlerKey = cacheStringFunction((str: string) =>
  str ? `on${capitalize(str)}` : ``
)

// compare whether a value has changed, accounting for NaN.
// 比较一个值是否发生了变化，包含 NaN。
// From createSetter:
// Return To createSetter: 比较一个值是否发生了变化，包含对 NaN的判断。
export const hasChanged = (value: any, oldValue: any): boolean =>
  // 判断value和oldValue是否相等，如果是NaN，则认为是相等
  !Object.is(value, oldValue)

export const invokeArrayFns = (fns: Function[], arg?: any) => {
  for (let i = 0; i < fns.length; i++) {
    fns[i](arg)
  }
}
// From initProps:
// Return To initProps: 不可枚举且值为value
export const def = (obj: object, key: string | symbol, value: any) => {
  Object.defineProperty(obj, key, {
    configurable: true,
    enumerable: false,
    value
  })
}

export const toNumber = (val: any): any => {
  const n = parseFloat(val)
  return isNaN(n) ? val : n
}

let _globalThis: any
export const getGlobalThis = (): any => {
  return (
    _globalThis ||
    (_globalThis =
      typeof globalThis !== 'undefined'
        ? globalThis
        : typeof self !== 'undefined'
        ? self
        : typeof window !== 'undefined'
        ? window
        : typeof global !== 'undefined'
        ? global
        : {})
  )
}
