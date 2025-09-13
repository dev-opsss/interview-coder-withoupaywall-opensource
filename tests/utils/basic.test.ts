/**
 * Basic utility function tests to verify Jest setup is working
 */

describe('Basic Functionality Tests', () => {
  test('should perform basic arithmetic', () => {
    expect(2 + 2).toBe(4);
    expect(10 - 5).toBe(5);
    expect(3 * 4).toBe(12);
    expect(8 / 2).toBe(4);
  });

  test('should handle string operations', () => {
    expect('hello'.toUpperCase()).toBe('HELLO');
    expect('WORLD'.toLowerCase()).toBe('world');
    expect('hello world'.split(' ')).toEqual(['hello', 'world']);
  });

  test('should handle array operations', () => {
    const arr = [1, 2, 3, 4, 5];
    expect(arr.length).toBe(5);
    expect(arr.filter(n => n > 3)).toEqual([4, 5]);
    expect(arr.map(n => n * 2)).toEqual([2, 4, 6, 8, 10]);
  });

  test('should handle object operations', () => {
    const obj = { name: 'Test', value: 42 };
    expect(obj.name).toBe('Test');
    expect(obj.value).toBe(42);
    expect(Object.keys(obj)).toEqual(['name', 'value']);
  });

  test('should handle promises', async () => {
    const promise = Promise.resolve('success');
    const result = await promise;
    expect(result).toBe('success');
  });

  test('should handle async/await', async () => {
    const asyncFunction = async () => {
      // Use immediate resolution instead of setTimeout to avoid timer issues
      return Promise.resolve('async result');
    };

    const result = await asyncFunction();
    expect(result).toBe('async result');
  });

  test('should handle error cases', () => {
    expect(() => {
      throw new Error('Test error');
    }).toThrow('Test error');
  });

  test('should handle mock functions', () => {
    const mockFn = jest.fn();
    mockFn('test');
    mockFn('test2');

    expect(mockFn).toHaveBeenCalledTimes(2);
    expect(mockFn).toHaveBeenCalledWith('test');
    expect(mockFn).toHaveBeenCalledWith('test2');
  });

  test('should handle mock return values', () => {
    const mockFn = jest.fn();
    mockFn.mockReturnValue('mocked');

    const result = mockFn();
    expect(result).toBe('mocked');
  });

  test('should handle mock implementations', () => {
    const mockFn = jest.fn((x: number) => x * 2);
    
    const result = mockFn(5);
    expect(result).toBe(10);
    expect(mockFn).toHaveBeenCalledWith(5);
  });
});
