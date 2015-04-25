var gulp = require('gulp')
var connect = require('gulp-connect')
var dalek = require('gulp-dalek')
var gcb = require('gulp-callback')
var del = require('del')

gulp.task('clean', function(done) {
	del(['dist', 'report'], done)
})

gulp.task('clean-lib', function(done) {
	del(['bower_components'], done)
})

gulp.task('cleanup', ['clean', 'clean-lib'])

gulp.task('_build', function() {
	
})

gulp.task('test', function() {
	connect.server({
		root : ['build'],
		port : 18000
	})

	return gulp.src(['tests/**.js'])
		.pipe(dalek({
			browser : ['phantomjs'],
			reporter : ['console', 'html']
		}))
		.pipe(gcb(function() {
			connect.serverClose();
		}))
})
