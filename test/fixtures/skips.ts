/** Patches that add, remove or move test skip markers, for `analyzeTests`. */

/** JS: one test skipped with `.skip(`, one suite with `xdescribe(`. */
export const jsSkips = [
  '@@ -10,6 +10,6 @@ describe("parser", () => {',
  '   it("parses numbers", () => {',
  '-  it("parses dates", () => {',
  '+  it.skip("parses dates", () => {',
  '     assert.ok(parse("2026-01-01"));',
  '   });',
  '@@ -40,2 +40,3 @@',
  ' ',
  '+xdescribe("legacy", () => {});',
].join('\n');

/** Python: a decorator and a skipif. */
export const pythonSkips = [
  '@@ -1,4 +1,6 @@',
  ' import pytest',
  ' ',
  '+@pytest.mark.skip(reason="flaky on CI")',
  ' def test_upload():',
  '@@ -20,2 +22,3 @@',
  '+@pytest.mark.skipif(sys.platform == "win32", reason="posix only")',
  ' def test_symlink():',
].join('\n');

/** Go: `t.Skip` and `t.Skipf` inside test functions. */
export const goSkips = [
  '@@ -5,3 +5,5 @@ func TestFetch(t *testing.T) {',
  '+\tt.Skip("needs network")',
  ' \tresp, err := fetch(url)',
  '@@ -30,2 +32,3 @@ func TestParse(t *testing.T) {',
  '+\tt.Skipf("broken on %s", runtime.GOOS)',
].join('\n');

/** Java: JUnit 5 `@Disabled` and JUnit 4 `@Ignore`. */
export const javaSkips = [
  '@@ -12,3 +12,5 @@ class ParserTest {',
  '+    @Disabled("until #44 is fixed")',
  '     @Test',
  '     void parsesDates() {',
  '@@ -40,1 +42,2 @@',
  '+    @Ignore',
].join('\n');

/** Skips removed: the test is enabled again. */
export const skipsRemoved = [
  '@@ -3,3 +3,3 @@',
  '-it.skip("parses dates", () => {',
  '+it("parses dates", () => {',
  '-@pytest.mark.skip',
].join('\n');

/** A skip that only moved and was re-indented, and one whose reason changed. */
export const skipsMoved = [
  '@@ -3,2 +3,1 @@',
  '-it.skip("a", () => {});',
  '-  @Disabled("old reason")',
  '@@ -30,0 +29,2 @@',
  '+    it.skip("a", () => {});',
  '+  @Disabled("new reason")',
].join('\n');

/** Skip markers in comments and look-alike calls that are not skips. */
export const notSkips = [
  '@@ -1,0 +1,6 @@',
  '+// it.skip("old") was flaky, fixed now',
  '+# @pytest.mark.skip was here',
  '+ * @Disabled in javadoc',
  '+const max = fix(1);',
  '+expect(list.skipped).toBe(0);',
  '+@pytest.mark.skipping_helper_not_a_skip',
].join('\n');
