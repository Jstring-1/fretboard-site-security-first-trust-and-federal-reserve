<?php

function do_url_stuff ( $str ) {
	$str = str_replace( "♭", "b", $str );
	$str = str_replace( "♯", "#", $str );
	$str = str_replace( " ", "", $str );
	$str = urlencode( $str );
	$url_stuff_done = $str;
	return $url_stuff_done;
}	
function undo_url_stuff ( $str ) {
	$str = urldecode( $str );
	$str = str_replace( "b", "♭", $str );
	$str = str_replace( "#", "♯", $str );
	$url_stuff_undone = $str;
	return $url_stuff_undone;
}	
function do_reverse_stuff ( $str ) {
	$str_arr = explode( " ", $str );
	$str_arr = array_reverse( $str_arr );
	$reverse_stuff_done = implode( " ", $str_arr );
	return $reverse_stuff_done;
}
function do_sort_degrees ( $str ) {
	$degrees = array("1","♭2","2","♭3","3","4","♭5","5","♭6","6","♭7","7");
	$dgs_arr = explode( " ", $str );
	$new_dgs = "";
	foreach ( $degrees as $k => $v ) {
		if ( in_array( $v, $dgs_arr ) ) {
			$new_dgs .= " ".$v;
		}
	}
	return trim( $new_dgs );
}	

?>